/**
 * The operator setup flow: check balances, top up role ETH from the deployer, deploy the
 * registry with the Foundry script, register both catalog releases (PROVIDER as provider,
 * EVALUATOR as evaluator) and bond them, then write the deployment record.
 *
 * `scripts/testnet-setup.ts` runs it against Arbitrum Sepolia; `scripts/demo-fork.ts` runs the
 * very same function against an Anvil fork first.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { encodeDeployData, getAddress, parseEther, type Abi, type Address, type Hex } from "viem";

import { USDC, eth, mined, readRelease, usdc, usdcBalance, type Clients } from "./chain.js";
import type { Role } from "./env.js";
import type { Narrator } from "./narrate.js";
import { CONTRACTS_DIR, catalogReleases, deployWithForgeScript, gitCommit, registerAndBond, writeDeploymentRecord, type ReleaseSetupResult } from "./registry-setup.js";

/** ETH policy per role: top up to `target` when below `min`. Arbitrum Sepolia gas is ~0.02-0.1 gwei. */
export const ETH_POLICY: Record<string, { min: string; target: string; why: string }> = {
  provider: { min: "0.0005", target: "0.001", why: "approve + depositBond per release" },
  facilitator: { min: "0.001", target: "0.003", why: "submits every x402 settlement" },
  evaluator: { min: "0.0003", target: "0.001", why: "finalizeOutcome / expireResolution" },
  buyer: { min: "0.0005", target: "0.002", why: "activateResolution, withdrawCredit" },
  benchmarkBuyer: { min: "0.0005", target: "0.002", why: "benchmark activations" },
};
/** ETH the deployer keeps for the deployment (~2.3M gas) and two registrations. */
export const DEPLOYER_RESERVE = "0.002";

export type SetupRoles = {
  deployer: Role;
  provider: Role;
  evaluator: Address;
  facilitator: Address;
  buyer: Address;
  benchmarkBuyer?: Address;
};

export type SetupOptions = {
  c: Clients;
  narr: Narrator;
  roles: SetupRoles;
  /** Path relative to contracts/ (deployments/421614.json for the real network). */
  deploymentFile: string;
  bondPerReleaseAtomic: bigint;
  /** Reuse this registry instead of deploying (also picked up from an existing record). */
  existingRegistry?: Address;
  redeploy?: boolean;
  dryRun: boolean;
  /** Values that must never appear in written files (private keys). */
  forbidden: string[];
  networkLabel: string;
};

export type SetupResult = { registry: Address | null; releases: ReleaseSetupResult[]; blocked: string[] };

function recordRegistry(file: string): Address | undefined {
  const path = join(CONTRACTS_DIR, file);
  if (!existsSync(path)) return undefined;
  try {
    const r = (JSON.parse(readFileSync(path, "utf8")) as { registry?: string }).registry;
    return r === undefined ? undefined : getAddress(r);
  } catch {
    return undefined;
  }
}

async function estimateDeployGas(c: Clients, deployer: Address): Promise<bigint | null> {
  try {
    const artifact = JSON.parse(readFileSync(join(CONTRACTS_DIR, "out", "ResolutionWarrantyRegistry.sol", "ResolutionWarrantyRegistry.json"), "utf8")) as {
      abi: Abi;
      bytecode: { object: Hex };
    };
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [USDC, deployer] });
    return await c.pub.estimateGas({ account: deployer, data });
  } catch {
    return null;
  }
}

export async function runSetup(o: SetupOptions): Promise<SetupResult> {
  const { c, narr, roles } = o;
  const blocked: string[] = [];
  const chainId = await c.pub.getChainId();
  if (chainId !== 421614) throw new Error(`RPC chain id is ${chainId}, expected 421614`);
  const usdcCode = await c.pub.getCode({ address: USDC });
  if (usdcCode === undefined || usdcCode === "0x") throw new Error("USDC has no code on this RPC");

  // ---------------------------------------------------------------- balances
  narr.step("1", `Role balances on ${o.networkLabel} (block ${await c.pub.getBlockNumber()})`);
  const all: Array<[string, Address]> = [
    ["deployer", roles.deployer.address],
    ["provider", roles.provider.address],
    ["facilitator", roles.facilitator],
    ["evaluator", roles.evaluator],
    ["buyer", roles.buyer],
    ...(roles.benchmarkBuyer !== undefined ? ([["benchmarkBuyer", roles.benchmarkBuyer]] as Array<[string, Address]>) : []),
  ];
  const ethBal: Record<string, bigint> = {};
  for (const [name, addr] of all) {
    ethBal[name] = await c.pub.getBalance({ address: addr });
    const code = await c.pub.getCode({ address: addr });
    narr.kv(name, `${addr}  ${eth(ethBal[name] as bigint)}  ${usdc(await usdcBalance(c.pub, addr))}${code !== undefined && code !== "0x" ? "  [HAS CODE: EIP-7702 delegation?]" : ""}`);
    if (code !== undefined && code !== "0x") blocked.push(`${name} ${addr} carries contract code; use a fresh EOA`);
  }
  const gasPrice = await c.pub.getGasPrice();
  narr.kv("gas price", `${Number(gasPrice) / 1e9} gwei`);

  // ---------------------------------------------------------------- plan
  narr.step("2", "Plan");
  const transfers: Array<{ name: string; to: Address; value: bigint }> = [];
  for (const [name, addr] of all) {
    const policy = ETH_POLICY[name];
    if (policy === undefined) continue;
    const have = ethBal[name] ?? 0n;
    if (have < parseEther(policy.min)) transfers.push({ name, to: addr, value: parseEther(policy.target) - have });
  }
  const transferTotal = transfers.reduce((s, t) => s + t.value, 0n);
  const reserve = parseEther(DEPLOYER_RESERVE);
  const transferGas = 21_000n * 3n * gasPrice * BigInt(transfers.length); // generous for Arbitrum L1 data fees
  const deployerNeeds = transferTotal + reserve + transferGas;
  for (const t of transfers) narr.say(`send ${eth(t.value)} deployer -> ${t.name} ${t.to} (${ETH_POLICY[t.name]?.why})`);
  if (transfers.length === 0) narr.say("no ETH top-ups needed");
  const deployerEth = ethBal.deployer ?? 0n;
  narr.kv("deployer ETH needed", `${eth(deployerNeeds)} (top-ups ${eth(transferTotal)} + reserve ${DEPLOYER_RESERVE} ETH), has ${eth(deployerEth)}`);
  if (deployerEth < deployerNeeds) blocked.push(`deployer ${roles.deployer.address} needs at least ${eth(deployerNeeds)} on ${o.networkLabel} (has ${eth(deployerEth)}); fund it from an Arbitrum Sepolia faucet`);

  let registry: Address | undefined = o.existingRegistry ?? (o.redeploy === true ? undefined : recordRegistry(o.deploymentFile));
  if (registry !== undefined) {
    const code = await c.pub.getCode({ address: registry });
    if (code === undefined || code === "0x") {
      narr.note(`recorded registry ${registry} has no code on this chain; a new one will be deployed`);
      registry = undefined;
    }
  }
  if (registry === undefined) {
    const gas = await estimateDeployGas(c, roles.deployer.address);
    narr.say(`deploy ResolutionWarrantyRegistry(usdc=${USDC}, admin=deployer ${roles.deployer.address}) via forge script Deploy${gas === null ? "" : ` (~${gas} gas, ~${eth(gas * gasPrice)})`}`);
  } else narr.say(`reuse registry ${registry}`);

  const releases = catalogReleases();
  const providerUsdc = await usdcBalance(c.pub, roles.provider.address);
  let bondNeeded = 0n;
  for (const r of releases) {
    const onchain = registry === undefined ? undefined : await readRelease(c.pub, registry, r.releaseId);
    const avail = onchain?.availableBond ?? 0n;
    if (onchain?.registered !== true) narr.say(`registerRelease ${r.manifest.id} (${r.releaseId}) provider=${roles.provider.address} evaluator=${roles.evaluator} price=${usdc(BigInt(r.manifest.priceAtomic))} window=${r.manifest.claimWindowSeconds}s`);
    else narr.say(`${r.manifest.id} already registered`);
    if (avail < o.bondPerReleaseAtomic) {
      bondNeeded += o.bondPerReleaseAtomic - avail;
      narr.say(`provider approve + depositBond ${usdc(o.bondPerReleaseAtomic - avail)} into ${r.manifest.id}`);
    }
  }
  if (providerUsdc < bondNeeded) blocked.push(`provider needs ${usdc(bondNeeded)} for bonds (has ${usdc(providerUsdc)})`);
  narr.say(`write contracts/${o.deploymentFile}`);

  if (o.dryRun) {
    narr.step("3", "Dry run: nothing was sent");
    if (blocked.length > 0) for (const b of blocked) narr.note(`BLOCKER: ${b}`);
    else narr.ok("ready: re-run with --yes to execute this plan");
    return { registry: registry ?? null, releases: [], blocked };
  }
  if (blocked.length > 0) throw new Error(`setup blocked:\n  - ${blocked.join("\n  - ")}`);

  // ---------------------------------------------------------------- execute
  narr.step("3", "Distribute ETH");
  for (const t of transfers) {
    const hash = await c.wallet(roles.deployer.account).sendTransaction({ to: t.to, value: t.value });
    await mined(c.pub, hash);
    narr.tx(`deployer -> ${t.name} ${eth(t.value)}`, hash);
  }

  narr.step("4", "Deploy registry (forge script Deploy)");
  let deployPatch: Record<string, unknown> = {};
  if (registry === undefined) {
    const d = deployWithForgeScript({ rpcUrl: c.rpcUrl, deployer: roles.deployer, admin: roles.deployer.address, deploymentFile: o.deploymentFile });
    registry = d.registry;
    narr.tx(`ResolutionWarrantyRegistry deployed at ${registry}`, d.txHash);
    deployPatch = { deployTxHash: d.txHash, deployBlockNumber: d.blockNumber };
  } else narr.say(`using existing registry ${registry}`);

  narr.step("5", "Register releases and bond");
  const results = await registerAndBond({
    c,
    narr,
    registry,
    admin: roles.deployer,
    provider: roles.provider,
    evaluator: roles.evaluator,
    plans: releases.map((release) => ({ release, bondTargetAtomic: o.bondPerReleaseAtomic })),
  });

  narr.step("6", "Deployment record");
  const path = writeDeploymentRecord(
    o.deploymentFile,
    {
      chainId: 421614,
      registry,
      usdc: USDC,
      sourceCommit: gitCommit(),
      ...deployPatch,
      roles: { admin: roles.deployer.address, provider: roles.provider.address, facilitator: roles.facilitator, evaluator: roles.evaluator },
      releases: results,
    },
    o.forbidden,
  );
  narr.kv("written", path);
  return { registry, releases: results, blocked: [] };
}

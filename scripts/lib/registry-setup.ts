/**
 * Registry deployment, release registration and provider bonding. Used by
 * `scripts/testnet-setup.ts` against Arbitrum Sepolia and, unchanged, by `scripts/demo-fork.ts`
 * against an Anvil fork, so the live path is rehearsed end to end before it is run.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadCatalog, type LoadedRelease } from "@lemma/catalog";
import { getAddress, type Address, type Hex } from "viem";

import { ERC20_ABI, REGISTRY_ABI, USDC, mined, readRelease, usdc, type Clients } from "./chain.js";
import { foundryBin } from "./anvil.js";
import { REPO_ROOT, type Role } from "./env.js";
import type { Narrator } from "./narrate.js";

export const CONTRACTS_DIR = join(REPO_ROOT, "contracts");

export function gitCommit(): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "unknown";
}

export type DeployResult = { registry: Address; txHash: Hex; blockNumber: string; record: Record<string, unknown> };

/**
 * Deploys with the real Foundry script (`script/Deploy.s.sol:Deploy`). The deployer key goes to
 * forge through the environment only, never argv.
 */
export function deployWithForgeScript(opts: {
  rpcUrl: string;
  deployer: Role;
  admin: Address;
  /** Path relative to contracts/, must be under deployments/. */
  deploymentFile: string;
}): DeployResult {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    FOUNDRY_OFFLINE: "true",
    DEPLOYER_PRIVATE_KEY: opts.deployer.privateKey,
    USDC_ADDRESS: USDC,
    REGISTRY_ADMIN_ADDRESS: opts.admin,
    EXPECTED_CHAIN_ID: "421614",
    SOURCE_COMMIT: gitCommit(),
    DEPLOYMENT_FILE: opts.deploymentFile,
    // Via env + the foundry.toml `arbitrum_sepolia` alias, not argv: RPC URLs can embed API
    // keys and argv is visible to other processes.
    ARBITRUM_SEPOLIA_RPC_URL: opts.rpcUrl,
  };
  const r = spawnSync(foundryBin("forge"), ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", "arbitrum_sepolia", "--broadcast", "--slow"], {
    cwd: CONTRACTS_DIR,
    env,
    encoding: "utf8",
    timeout: 600_000,
  });
  const scrub = (s: string) => s.split(opts.deployer.privateKey).join("[REDACTED]").split(opts.rpcUrl).join("[RPC]");
  if (r.status !== 0) throw new Error(`forge script Deploy failed:\n${scrub((r.stderr || r.stdout || "").slice(-2000))}`);
  const record = JSON.parse(readFileSync(join(CONTRACTS_DIR, opts.deploymentFile), "utf8")) as Record<string, unknown>;
  const registry = getAddress(String(record.registry));
  const broadcast = JSON.parse(readFileSync(join(CONTRACTS_DIR, "broadcast", "Deploy.s.sol", "421614", "run-latest.json"), "utf8")) as {
    transactions: Array<{ hash: Hex; contractAddress?: string | null }>;
    receipts: Array<{ transactionHash: Hex; blockNumber: string }>;
  };
  const tx = broadcast.transactions.find((t) => t.contractAddress != null && getAddress(t.contractAddress) === registry);
  if (tx === undefined) throw new Error("deployment transaction not found in the forge broadcast log");
  const rc = broadcast.receipts.find((x) => x.transactionHash === tx.hash);
  return { registry, txHash: tx.hash, blockNumber: rc === undefined ? String(record.blockNumber) : BigInt(rc.blockNumber).toString(), record };
}

export type ReleasePlan = { release: LoadedRelease; bondTargetAtomic: bigint };

export function catalogReleases(): LoadedRelease[] {
  const catalog = loadCatalog();
  return catalog.listReleases().map((m) => {
    const r = catalog.getRelease(m.id);
    if (r === undefined) throw new Error(`release ${m.id} missing`);
    return r;
  });
}

export type ReleaseSetupResult = {
  id: string;
  releaseId: Hex;
  provider: Address;
  evaluator: Address;
  priceAtomic: string;
  claimWindowSeconds: number;
  registerTxHash: Hex | null;
  bondTxHashes: Hex[];
  availableBondAtomic: string;
  reservedBondAtomic: string;
};

/**
 * Registers each release (admin) unless already registered with the same terms, then tops the
 * provider bond up to `bondTargetAtomic` of available bond. Idempotent.
 */
export async function registerAndBond(opts: {
  c: Clients;
  narr: Narrator;
  registry: Address;
  admin: Role;
  provider: Role;
  evaluator: Address;
  plans: ReleasePlan[];
}): Promise<ReleaseSetupResult[]> {
  const { c, narr, registry } = opts;
  const results: ReleaseSetupResult[] = [];
  for (const { release, bondTargetAtomic } of opts.plans) {
    const m = release.manifest;
    const price = BigInt(m.priceAtomic);
    let onchain = await readRelease(c.pub, registry, release.releaseId);
    let registerTxHash: Hex | null = null;
    if (!onchain.registered) {
      const hash = await c.wallet(opts.admin.account).writeContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: "registerRelease",
        args: [release.releaseId, opts.provider.address, opts.evaluator, price, BigInt(m.claimWindowSeconds)],
      });
      await mined(c.pub, hash);
      registerTxHash = hash;
      narr.tx(`registerRelease ${m.id} (price ${usdc(price)}, claim window ${m.claimWindowSeconds / 3600}h)`, hash);
      onchain = await readRelease(c.pub, registry, release.releaseId);
    } else {
      narr.say(`${m.id} already registered`);
    }
    if (getAddress(onchain.provider) !== opts.provider.address || getAddress(onchain.evaluator) !== getAddress(opts.evaluator) || onchain.price !== price) {
      throw new Error(`${m.id} is registered onchain with different provider/evaluator/price; refusing to continue`);
    }

    const bondTxHashes: Hex[] = [];
    if (onchain.availableBond < bondTargetAtomic) {
      const top = bondTargetAtomic - onchain.availableBond;
      const allowance = await c.pub.readContract({ address: USDC, abi: ERC20_ABI, functionName: "allowance", args: [opts.provider.address, registry] });
      if (allowance < top) {
        const a = await c.wallet(opts.provider.account).writeContract({ address: USDC, abi: ERC20_ABI, functionName: "approve", args: [registry, top] });
        await mined(c.pub, a);
        bondTxHashes.push(a);
        narr.tx(`provider approves ${usdc(top)} for ${m.id}`, a);
      }
      const d = await c.wallet(opts.provider.account).writeContract({ address: registry, abi: REGISTRY_ABI, functionName: "depositBond", args: [release.releaseId, top] });
      await mined(c.pub, d);
      bondTxHashes.push(d);
      narr.tx(`provider depositBond ${usdc(top)} into ${m.id}`, d);
      onchain = await readRelease(c.pub, registry, release.releaseId);
    } else {
      narr.say(`${m.id} bond already at ${usdc(onchain.availableBond)} available`);
    }
    results.push({
      id: m.id,
      releaseId: release.releaseId,
      provider: getAddress(onchain.provider),
      evaluator: getAddress(onchain.evaluator),
      priceAtomic: onchain.price.toString(),
      claimWindowSeconds: Number(onchain.claimWindow),
      registerTxHash,
      bondTxHashes,
      availableBondAtomic: onchain.availableBond.toString(),
      reservedBondAtomic: onchain.reservedBond.toString(),
    });
  }
  return results;
}

/**
 * Merges public fields into a deployment record (path relative to contracts/). Refuses to write
 * if any of the `forbidden` values (the role private keys) would appear in it.
 */
export function writeDeploymentRecord(file: string, patch: Record<string, unknown>, forbidden: string[]): string {
  const path = join(CONTRACTS_DIR, file);
  const existing = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
  const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  const text = `${JSON.stringify(merged, null, 2)}\n`;
  const lower = text.toLowerCase();
  for (const f of forbidden) {
    if (f.length >= 8 && (lower.includes(f.toLowerCase()) || lower.includes(f.toLowerCase().replace(/^0x/, "")))) {
      throw new Error("refusing to write a deployment record that contains a secret value");
    }
  }
  writeFileSync(path, text);
  return path;
}

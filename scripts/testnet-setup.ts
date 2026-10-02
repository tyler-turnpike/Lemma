/**
 * Arbitrum Sepolia operator setup (live network).
 *
 *   npm run testnet:setup -- --dry-run     # read-only: balances + planned actions
 *   npm run testnet:setup -- --yes         # execute the plan
 *
 * Steps: check role balances; top up role ETH from the deployer when low; deploy
 * ResolutionWarrantyRegistry with `forge script Deploy` (DEPLOYER key, admin = deployer);
 * register both catalog releases with PROVIDER as provider and EVALUATOR as evaluator; provider
 * approves and deposits the bond (default 1 USDC per release); write
 * contracts/deployments/421614.json; print the env lines to add.
 *
 * Options:
 *   --bond 1.00            bond per release in USDC (available bond is topped up to this)
 *   --registry 0x...       reuse an existing registry (default: RESOLUTION_WARRANTY_REGISTRY_ADDRESS,
 *                          then the deployment record)
 *   --redeploy             ignore the existing deployment record and deploy a new registry
 *   --rpc URL              default ARBITRUM_SEPOLIA_RPC_URL, then the public endpoint
 *   --dotenv PATH          default <repo>/.env (read programmatically, never printed)
 *
 * Idempotent: re-running skips registered releases and only tops bonds up.
 */
import { join } from "node:path";

import { parseUsdc } from "@lemma/core";
import { getAddress, type Address } from "viem";

import { clients } from "./lib/chain.js";
import { PUBLIC_ARBITRUM_SEPOLIA_RPC, REPO_ROOT, Scrubber, loadEnv, optional, roleFromEnv } from "./lib/env.js";
import { ARBISCAN, Narrator } from "./lib/narrate.js";
import { runSetup } from "./lib/setup-flow.js";

const scrubber = new Scrubber();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const env = loadEnv(value("dotenv") ?? join(REPO_ROOT, ".env"));
  scrubber.addFromEnv(env);
  const rpcUrl = value("rpc") ?? optional(env, "ARBITRUM_SEPOLIA_RPC_URL") ?? PUBLIC_ARBITRUM_SEPOLIA_RPC;
  if (rpcUrl !== PUBLIC_ARBITRUM_SEPOLIA_RPC) scrubber.add(rpcUrl);
  const dryRun = flag("dry-run") || !flag("yes");
  const narr = new Narrator(scrubber, ARBISCAN);

  const deployer = roleFromEnv(env, "deployer", "DEPLOYER_PRIVATE_KEY", "DEPLOYER_ADDRESS");
  const provider = roleFromEnv(env, "provider", "PROVIDER_PRIVATE_KEY", "PROVIDER_ADDRESS");
  const addr = (name: string, keyVar: string) => {
    const declared = optional(env, name);
    if (declared !== undefined) {
      const key = optional(env, keyVar);
      if (key !== undefined) roleFromEnv(env, name, keyVar, name); // address/key consistency
      return getAddress(declared);
    }
    return roleFromEnv(env, name, keyVar).address;
  };
  const evaluator = addr("EVALUATOR_ADDRESS", "EVALUATOR_PRIVATE_KEY");
  const facilitator = addr("FACILITATOR_ADDRESS", "FACILITATOR_PRIVATE_KEY");
  const buyer = addr("BUYER_ADDRESS", "BUYER_PRIVATE_KEY");
  const benchmarkBuyer = optional(env, "BENCHMARK_BUYER_ADDRESS") !== undefined || optional(env, "BENCHMARK_BUYER_PRIVATE_KEY") !== undefined ? addr("BENCHMARK_BUYER_ADDRESS", "BENCHMARK_BUYER_PRIVATE_KEY") : undefined;
  const lemmaProvider = optional(env, "LEMMA_PROVIDER_ADDRESS");
  if (lemmaProvider !== undefined && getAddress(lemmaProvider) !== provider.address) throw new Error("LEMMA_PROVIDER_ADDRESS does not equal the provider address");
  const distinct = new Set([deployer.address, provider.address, evaluator, facilitator, buyer]);
  if (distinct.size !== 5) throw new Error("deployer, provider, evaluator, facilitator and buyer must be distinct addresses");

  const forbidden = ["DEPLOYER_PRIVATE_KEY", "PROVIDER_PRIVATE_KEY", "FACILITATOR_PRIVATE_KEY", "EVALUATOR_PRIVATE_KEY", "BUYER_PRIVATE_KEY", "BENCHMARK_BUYER_PRIVATE_KEY"]
    .map((k) => optional(env, k))
    .filter((v): v is string => v !== undefined);
  const existing = value("registry") ?? optional(env, "RESOLUTION_WARRANTY_REGISTRY_ADDRESS");

  narr.banner(`Lemma testnet setup — Arbitrum Sepolia ${dryRun ? "(DRY RUN, read-only)" : "(LIVE)"}`);
  const c = clients(rpcUrl);
  const result = await runSetup({
    c,
    narr,
    roles: { deployer, provider, evaluator, facilitator, buyer, ...(benchmarkBuyer !== undefined ? { benchmarkBuyer } : {}) },
    deploymentFile: "deployments/421614.json",
    bondPerReleaseAtomic: parseUsdc(value("bond") ?? "1.00"),
    ...(existing !== undefined ? { existingRegistry: getAddress(existing) as Address } : {}),
    redeploy: flag("redeploy"),
    dryRun,
    forbidden,
    networkLabel: "Arbitrum Sepolia",
  });

  if (dryRun) {
    if (!flag("dry-run")) narr.note("no --yes given, so this was a dry run");
    process.exitCode = result.blocked.length > 0 ? 2 : 0;
    return;
  }
  narr.step("7", "Add to .env (server, bridge, evaluator) and Railway");
  narr.say(`RESOLUTION_WARRANTY_REGISTRY_ADDRESS=${result.registry}`);
  narr.say(`LEMMA_PROVIDER_ADDRESS=${provider.address}`);
  narr.say(`EVALUATOR_ADDRESS=${evaluator}`);
  narr.say("");
  narr.say(`Registry: ${ARBISCAN.address(String(result.registry))}`);
  narr.say("Optional source verification (needs an Arbiscan API key):");
  narr.say(`  cd contracts && forge verify-contract ${result.registry} src/ResolutionWarrantyRegistry.sol:ResolutionWarrantyRegistry --chain 421614 --constructor-args $(cast abi-encode "constructor(address,address)" 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d ${deployer.address}) --etherscan-api-key $ARBISCAN_API_KEY`);
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message) : String(error);
  process.stderr.write(`\ntestnet-setup failed: ${scrubber.scrub(msg)}\n`);
  process.exit(1);
});

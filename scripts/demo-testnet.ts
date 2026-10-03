/**
 * The demo narrative on live Arbitrum Sepolia (spends real testnet USDC and ETH).
 *
 *   npm run demo:testnet                  # read-only preflight: config, balances, bonds
 *   npm run demo:testnet -- --yes         # run the demo (local server + real bridge + evaluator)
 *   npm run demo:testnet -- --yes --api https://lemma.up.railway.app   # use a deployed server
 *
 * Requires `npm run testnet:setup -- --yes` first (registry deployed, releases registered and
 * bonded, role ETH distributed). Reads <repo>/.env programmatically; never prints secrets.
 *
 * Options:
 *   --api URL        use an already running Lemma server instead of starting one locally. It
 *                    must use the same registry and must NOT set LEMMA_ALLOW_PROVISIONAL, so
 *                    every sale is one the pricing rule permits on its own.
 *   --memory         local server uses in-memory storage (default: throwaway Postgres 16 when
 *                    available, else memory)
 *   --env-database   local server uses DATABASE_URL from .env
 *   --dotenv PATH    default <repo>/.env
 *   --keep           keep the scratch directory (always kept, with log tails printed, on failure)
 *
 * Cost per run: 0.24 USDC from the buyer (0.12 kept by the provider for the passing resolution,
 * 0.12 refunded from the bond for the prepared failure), about 8 small transactions of gas
 * across facilitator, buyer and evaluator. Expiry is not demonstrated live (72h window).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCatalog } from "@lemma/catalog";
import { getAddress, parseEther, type Address } from "viem";

import { clients, eth, readRelease, usdc, usdcBalance } from "./lib/chain.js";
import { runDemo } from "./lib/demo.js";
import { PUBLIC_ARBITRUM_SEPOLIA_RPC, REPO_ROOT, Scrubber, childEnv, loadEnv, optional, roleFromEnv } from "./lib/env.js";
import { ARBISCAN, Narrator } from "./lib/narrate.js";
import { CONTRACTS_DIR } from "./lib/registry-setup.js";
import { failureReport, requireBuilt, startServer, startThrowawayPostgres, type RunningServer } from "./lib/server.js";

const scrubber = new Scrubber();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (n: string) => argv.includes(`--${n}`);
  const value = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  requireBuilt();
  const env = loadEnv(value("dotenv") ?? join(REPO_ROOT, ".env"));
  scrubber.addFromEnv(env);
  const rpcUrl = optional(env, "ARBITRUM_SEPOLIA_RPC_URL") ?? PUBLIC_ARBITRUM_SEPOLIA_RPC;
  if (rpcUrl !== PUBLIC_ARBITRUM_SEPOLIA_RPC) scrubber.add(rpcUrl);
  const narr = new Narrator(scrubber, ARBISCAN);
  const live = flag("yes");

  const provider = roleFromEnv(env, "provider", "PROVIDER_PRIVATE_KEY", "PROVIDER_ADDRESS");
  const facilitator = roleFromEnv(env, "facilitator", "FACILITATOR_PRIVATE_KEY", "FACILITATOR_ADDRESS");
  const evaluator = roleFromEnv(env, "evaluator", "EVALUATOR_PRIVATE_KEY", "EVALUATOR_ADDRESS");
  const buyer = roleFromEnv(env, "buyer", "BUYER_PRIVATE_KEY", "BUYER_ADDRESS");
  const lemmaProvider = optional(env, "LEMMA_PROVIDER_ADDRESS");
  if (lemmaProvider !== undefined && getAddress(lemmaProvider) !== provider.address) throw new Error("LEMMA_PROVIDER_ADDRESS does not equal PROVIDER_ADDRESS");

  const recordPath = join(CONTRACTS_DIR, "deployments", "421614.json");
  const fromRecord = existsSync(recordPath) ? (JSON.parse(readFileSync(recordPath, "utf8")) as { registry?: string }).registry : undefined;
  const registryRaw = optional(env, "RESOLUTION_WARRANTY_REGISTRY_ADDRESS") ?? fromRecord;

  narr.banner(`Lemma demo — Arbitrum Sepolia ${live ? "(LIVE: spends testnet USDC and ETH)" : "(PREFLIGHT, read-only)"}`);
  const c = clients(rpcUrl);
  const chainId = await c.pub.getChainId();
  if (chainId !== 421614) throw new Error(`RPC chain id is ${chainId}, expected 421614`);

  // ------------------------------------------------------------------ preflight
  narr.step("preflight", "Configuration and balances");
  const blockers: string[] = [];
  if (registryRaw === undefined) blockers.push("no registry: set RESOLUTION_WARRANTY_REGISTRY_ADDRESS or run `npm run testnet:setup -- --yes`");
  const registry = registryRaw === undefined ? undefined : (getAddress(registryRaw) as Address);
  if (registry !== undefined) {
    narr.kv("registry", ARBISCAN.address(registry));
    const code = await c.pub.getCode({ address: registry });
    if (code === undefined || code === "0x") blockers.push(`registry ${registry} has no code on Arbitrum Sepolia`);
    else {
      for (const m of loadCatalog().listReleases()) {
        const rel = loadCatalog().getRelease(m.id);
        if (rel === undefined) continue;
        const r = await readRelease(c.pub, registry, rel.releaseId);
        narr.kv(`release ${m.id}`, r.registered ? `provider ${r.provider}, evaluator ${r.evaluator}, bond ${usdc(r.availableBond)} available` : "NOT REGISTERED");
        if (!r.registered) blockers.push(`${m.id} is not registered`);
        else {
          if (getAddress(r.provider) !== provider.address) blockers.push(`${m.id} provider ${r.provider} != PROVIDER_ADDRESS`);
          if (getAddress(r.evaluator) !== evaluator.address) blockers.push(`${m.id} evaluator ${r.evaluator} != EVALUATOR_ADDRESS`);
        }
      }
      const server = loadCatalog().getRelease("x402-mcp-server@1.1.0");
      if (server !== undefined) {
        const r = await readRelease(c.pub, registry, server.releaseId);
        if (r.availableBond < 2n * BigInt(server.manifest.priceAtomic)) blockers.push(`x402-mcp-server@1.1.0 needs >= ${usdc(2n * BigInt(server.manifest.priceAtomic))} available bond`);
      }
    }
  }
  const needs: Array<[string, Address, bigint, bigint]> = [
    ["facilitator", facilitator.address, parseEther("0.0005"), 0n],
    ["buyer", buyer.address, parseEther("0.0005"), 240_000n],
    ["evaluator", evaluator.address, parseEther("0.0002"), 0n],
  ];
  for (const [name, addr, minEth, minUsdc] of needs) {
    const e = await c.pub.getBalance({ address: addr });
    const u = await usdcBalance(c.pub, addr);
    narr.kv(name, `${addr}  ${eth(e)}  ${usdc(u)}`);
    if (e < minEth) blockers.push(`${name} needs >= ${eth(minEth)} (has ${eth(e)}); run testnet:setup or fund from a faucet`);
    if (u < minUsdc) blockers.push(`${name} needs >= ${usdc(minUsdc)}`);
    const code = await c.pub.getCode({ address: addr });
    if (code !== undefined && code !== "0x") blockers.push(`${name} ${addr} carries contract code`);
  }
  narr.kv("provider", provider.address);
  // The local server, bridge and evaluator run as child processes; make sure they can reach the
  // RPC with the environment they will get (proxy / extra CA settings included).
  const probe = spawnSync(process.execPath, ["-e", `fetch(process.env.RPC,{method:"POST",headers:{"content-type":"application/json"},body:'{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'}).then(r=>r.json()).then(j=>{process.stdout.write(String(j.result))},e=>{process.stdout.write("ERR "+(e.cause?.code??e.message));})`], {
    env: childEnv({ RPC: rpcUrl }),
    encoding: "utf8",
    timeout: 30_000,
  });
  const childOk = probe.stdout.trim() === "0x66eee";
  narr.kv("child-process RPC", childOk ? "reachable" : `NOT reachable (${scrubber.scrub(probe.stdout.trim() || probe.stderr.trim()).slice(0, 120)})`);
  if (!childOk) blockers.push("child processes cannot reach ARBITRUM_SEPOLIA_RPC_URL (check HTTPS_PROXY / NODE_EXTRA_CA_CERTS)");
  const api = value("api");
  if (api !== undefined) {
    try {
      const status = (await (await fetch(`${api.replace(/\/+$/, "")}/api/v1/status`)).json()) as { registry?: string; provisionalOverride?: boolean; paidTools?: { enabled: boolean } };
      narr.kv("remote server", `${api} registry ${status.registry} provisional ${status.provisionalOverride} paid ${status.paidTools?.enabled}`);
      if (registry !== undefined && (status.registry ?? "").toLowerCase() !== registry.toLowerCase()) blockers.push(`server ${api} uses registry ${status.registry}`);
      if (status.provisionalOverride === true) blockers.push(`server ${api} runs with LEMMA_ALLOW_PROVISIONAL=true; unset it so the demo only sells releases the pricing rule permits`);
      if (status.paidTools?.enabled !== true) blockers.push(`server ${api} has paid tools disabled`);
    } catch (error) {
      blockers.push(`server ${api} unreachable (${(error as Error).message})`);
    }
  }
  for (const b of blockers) narr.note(`BLOCKER: ${b}`);
  if (!live) {
    narr.say(blockers.length === 0 ? "preflight ok: run again with --yes to execute the live demo" : "fix the blockers above, then run again with --yes");
    process.exitCode = blockers.length === 0 ? 0 : 2;
    return;
  }
  if (blockers.length > 0 || registry === undefined) throw new Error("preflight failed");

  // ------------------------------------------------------------------ live run
  const workDir = mkdtempSync(join(tmpdir(), "lemma-demo-testnet-"));
  const cleanups: Array<() => void | Promise<void>> = [];
  let server: RunningServer | null = null;
  let passed = false;
  try {
    let serverUrl = api?.replace(/\/+$/, "");
    if (serverUrl === undefined) {
      const dbUrl = flag("env-database") ? optional(env, "DATABASE_URL") : undefined;
      const pg = dbUrl !== undefined || flag("memory") ? null : await startThrowawayPostgres();
      if (pg !== null) cleanups.push(() => pg.stop());
      const databaseUrl = dbUrl ?? pg?.url;
      server = await startServer(
        {
          NODE_ENV: "development",
          ...(databaseUrl !== undefined ? { DATABASE_URL: databaseUrl } : {}),
          ARBITRUM_SEPOLIA_RPC_URL: rpcUrl,
          RESOLUTION_WARRANTY_REGISTRY_ADDRESS: registry,
          PROVIDER_ADDRESS: provider.address,
          PROVIDER_PRIVATE_KEY: provider.privateKey,
          FACILITATOR_ADDRESS: facilitator.address,
          FACILITATOR_PRIVATE_KEY: facilitator.privateKey,
          EVALUATOR_ADDRESS: evaluator.address,
        },
        workDir,
      );
      const srv = server;
      cleanups.push(() => srv.stop());
      serverUrl = server.url;
      narr.kv("server", `${server.url} (local, ${databaseUrl !== undefined ? "Postgres" : "in-memory"}; log ${server.logFile})`);
    }
    await runDemo({
      mode: "testnet",
      narr,
      c,
      rpcUrl,
      registry,
      serverUrl,
      provider: provider.address,
      facilitator: facilitator.address,
      evaluator,
      buyer,
      workDir,
    });
    narr.banner("LIVE DEMO PASSED");
    passed = true;
    narr.say("Arbiscan links for every transaction are printed above.");
  } finally {
    if (!passed) process.stderr.write(`\n${failureReport(workDir, server, (s) => scrubber.scrub(s))}\n`);
    for (const fn of cleanups.reverse()) {
      try {
        await fn();
      } catch {
        /* best effort */
      }
    }
    if (flag("keep") || !passed) process.stdout.write(`kept ${workDir}\n`);
    else rmSync(workDir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error: unknown) => {
    const msg = error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message) : String(error);
    process.stderr.write(`\ndemo-testnet failed: ${scrubber.scrub(msg)}\n`);
    process.exit(1);
  },
);

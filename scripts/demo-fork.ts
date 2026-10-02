/**
 * Full Lemma product flow on an Anvil fork of Arbitrum Sepolia. Not part of `npm test`.
 *
 *   npm run demo:fork                 # builds, then runs everything
 *   npx tsx scripts/demo-fork.ts [--memory] [--keep]
 *
 *   --memory   use the server's in-memory repository instead of a throwaway Postgres 16 cluster
 *   --keep     keep the scratch directory (workspaces, bridge state, server/bridge logs)
 *
 * What runs, all real code, only Anvil's public dev keys:
 *   1. anvil --fork-url <Arbitrum Sepolia> (chain 421614, real USDC bytecode)
 *   2. the operator setup flow from scripts/testnet-setup.ts: ETH top-ups from the deployer,
 *      `forge script Deploy` (record written to contracts/deployments/fork-421614.json),
 *      registration of both catalog releases, 1 USDC provider bond per release
 *   3. the production server entry (`node apps/server/dist/index.js`) on Postgres, with the
 *      self-hosted facilitator settling on the fork and LEMMA_ALLOW_PROVISIONAL=true
 *   4. the `lemma-mcp` bridge bin spawned over stdio with the MCP SDK client, like a coding agent
 *   5. the evaluator CLI (scripts/evaluator.ts) for Passed, Failed and expiry
 *   6. an injected network fault: the failure-path purchase response is dropped after
 *      settlement and the bridge must recover it without paying twice
 * Exits non-zero on any failed check.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { privateKeyToAccount } from "viem/accounts";

import { ANVIL_DEV_KEYS, clearCode, setEthBalance, setUsdcBalances, startAnvilFork, timeTravel } from "./lib/anvil.js";
import { clients } from "./lib/chain.js";
import { runDemo } from "./lib/demo.js";
import { PUBLIC_ARBITRUM_SEPOLIA_RPC, Scrubber, type Role } from "./lib/env.js";
import { startFaultProxy } from "./lib/fault-proxy.js";
import { FORK_EXPLORER, Narrator } from "./lib/narrate.js";
import { failureReport, requireBuilt, startServer, startThrowawayPostgres, type RunningServer } from "./lib/server.js";
import { runSetup } from "./lib/setup-flow.js";

const role = (name: keyof typeof ANVIL_DEV_KEYS): Role => {
  const account = privateKeyToAccount(ANVIL_DEV_KEYS[name]);
  return { name, account, privateKey: ANVIL_DEV_KEYS[name], address: account.address };
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  requireBuilt();
  const forkSource = process.env.ARBITRUM_SEPOLIA_RPC_URL?.trim() || PUBLIC_ARBITRUM_SEPOLIA_RPC;
  const scrubber = new Scrubber();
  if (forkSource !== PUBLIC_ARBITRUM_SEPOLIA_RPC) scrubber.add(forkSource);
  const narr = new Narrator(scrubber, FORK_EXPLORER);
  const workDir = mkdtempSync(join(tmpdir(), "lemma-demo-fork-"));
  const cleanups: Array<() => void | Promise<void>> = [];
  let server: RunningServer | null = null;
  let passed = false;

  const roles = {
    deployer: role("deployer"),
    provider: role("provider"),
    facilitator: role("facilitator"),
    evaluator: role("evaluator"),
    buyer: role("buyer"),
  };

  try {
    narr.banner("Lemma end-to-end demo — Anvil fork of Arbitrum Sepolia (no real funds)");
    narr.kv("fork source", forkSource);
    narr.kv("scratch dir", workDir);
    const anvil = await startAnvilFork(forkSource);
    cleanups.push(() => anvil.stop());
    const c = clients(anvil.url);
    narr.kv("anvil", `${anvil.url} (fork block ${await c.pub.getBlockNumber()})`);

    // Fork prep: dev keys are public and carry sweeper-bot EIP-7702 code on Arbitrum Sepolia.
    // Give the deployer ETH and leave the other roles at 0 ETH so the setup flow's ETH
    // distribution is exercised; mirror the real wallets' 20 USDC.
    for (const r of Object.values(roles)) {
      if (await clearCode(c.pub, r.address)) narr.say(`cleared forked EIP-7702 code at ${r.name} ${r.address}`);
      await setEthBalance(c.pub, r.address, r.name === "deployer" ? 10n ** 18n : 0n);
    }
    await setUsdcBalances(c.pub, [
      [roles.buyer.address, 20_000_000n],
      [roles.provider.address, 20_000_000n],
    ]);

    // ------------------------------------------------------------ operator setup (same code as testnet-setup.ts)
    narr.banner("Operator setup (scripts/testnet-setup.ts flow, on the fork)");
    const setup = await runSetup({
      c,
      narr,
      roles: { deployer: roles.deployer, provider: roles.provider, evaluator: roles.evaluator.address, facilitator: roles.facilitator.address, buyer: roles.buyer.address },
      deploymentFile: "deployments/fork-421614.json",
      bondPerReleaseAtomic: 1_000_000n,
      redeploy: true,
      dryRun: false,
      forbidden: Object.values(ANVIL_DEV_KEYS),
      networkLabel: "anvil fork",
    });
    if (setup.registry === null) throw new Error("setup produced no registry");
    const registry = setup.registry;

    // ------------------------------------------------------------ server
    const pg = args.includes("--memory") ? null : await startThrowawayPostgres();
    if (pg !== null) cleanups.push(() => pg.stop());
    server = await startServer(
      {
        NODE_ENV: "development",
        ...(pg !== null ? { DATABASE_URL: pg.url } : {}),
        ARBITRUM_SEPOLIA_RPC_URL: anvil.url,
        RESOLUTION_WARRANTY_REGISTRY_ADDRESS: registry,
        PROVIDER_ADDRESS: roles.provider.address,
        PROVIDER_PRIVATE_KEY: roles.provider.privateKey,
        FACILITATOR_ADDRESS: roles.facilitator.address,
        FACILITATOR_PRIVATE_KEY: roles.facilitator.privateKey,
        EVALUATOR_ADDRESS: roles.evaluator.address,
        LEMMA_ALLOW_PROVISIONAL: "true",
      },
      workDir,
    );
    const srv = server;
    cleanups.push(() => srv.stop());
    narr.kv("server", `${server.url} (node apps/server/dist/index.js, ${pg !== null ? "Postgres 16 throwaway cluster" : "in-memory repository"})`);

    const proxy = await startFaultProxy(server.url);
    cleanups.push(() => proxy.close());

    // ------------------------------------------------------------ demo
    narr.banner("Demo: a coding agent using lemma-mcp");
    {
      await runDemo({
        mode: "fork",
        narr,
        c,
        rpcUrl: anvil.url,
        registry,
        serverUrl: server.url,
        provider: roles.provider.address,
        facilitator: roles.facilitator.address,
        evaluator: roles.evaluator,
        buyer: roles.buyer,
        workDir,
        timeTravel: (s) => timeTravel(c.pub, s),
        faultProxy: proxy,
      });
    }
    narr.banner("DEMO PASSED");
    passed = true;
  } finally {
    if (!passed) process.stderr.write(`\n${failureReport(workDir, server, (s) => scrubber.scrub(s))}\n`);
    for (const fn of cleanups.reverse()) {
      try {
        await fn();
      } catch {
        /* best effort */
      }
    }
    if (args.includes("--keep") || !passed) process.stdout.write(`kept ${workDir}\n`);
    else rmSync(workDir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`\nDEMO FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);

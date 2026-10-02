/**
 * The Lemma demo narrative, shared by `scripts/demo-fork.ts` (Anvil fork) and
 * `scripts/demo-testnet.ts` (Arbitrum Sepolia). Every buyer action goes through the real
 * `lemma-mcp` bridge over stdio; the evaluator acts through `scripts/evaluator.ts`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { loadCatalog } from "@lemma/catalog";
import { formatUsdc, type Preview } from "@lemma/core";
import type { Address, Hex } from "viem";

import { BridgeSession, type BridgeEnv } from "./bridge.js";
import { REGISTRY_ABI, eth, mined, readCredit, readRelease, readWarranty, signedUsdc, statusName, usdc, usdcBalance, type Clients } from "./chain.js";
import { REPO_ROOT, childEnv, type Role } from "./env.js";
import type { FaultProxy } from "./fault-proxy.js";
import type { Narrator } from "./narrate.js";
import { fixtureWorkspace, preparedFailureWorkspace } from "./workspace.js";

export type DemoConfig = {
  mode: "fork" | "testnet";
  narr: Narrator;
  c: Clients;
  /** RPC URL handed to the bridge (warranty activation) and the evaluator CLI. */
  rpcUrl: string;
  registry: Address;
  serverUrl: string;
  provider: Address;
  facilitator: Address;
  evaluator: Role;
  buyer: Role;
  /** Scratch root for workspaces, bridge state and logs. */
  workDir: string;
  /** Fork only: advance chain time (used for the expiry appendix). */
  timeTravel?: (seconds: number) => Promise<void>;
  /** Optional proxy that drops one paid response (proves lost-response recovery). */
  faultProxy?: FaultProxy;
};

type PreviewData = { preview: Preview; local: { priceUsdc: string | null; purchaseAllowedByLocalPolicy: boolean; policyReasons: string[]; spentTodayUsdc: string; dailyCapUsdc: string } };
type BuyData = {
  status: string;
  resolutionId: Hex;
  release: string;
  priceAtomic: string;
  paymentHash: Hex;
  payloadDigest: Hex;
  voucherSigner: Address;
  activation: { status: string; txHash: Hex | null; reason: string | null } | null;
  files: Array<{ path: string; op: string }>;
};
type ApplyData = { dryRun: boolean; filesChanged: number; changes: Array<{ path: string; op: string; status: string }>; dependencyChanges: Array<{ section: string; name: string; version: string }> };
type VerifyData = { outcome: string; submitted: boolean; receiptId: string | null; submitError: string | null; receipt: { evidenceDigest: Hex; testSummary: { passed: number; failed: number; skipped: number; durationMs: number } } };

const TASK_SERVER = "x402-paywall-mcp-server";
const TASK_CLIENT = "x402-paying-mcp-client";

export async function runDemo(cfg: DemoConfig): Promise<void> {
  const { narr, c, registry } = cfg;
  const catalog = loadCatalog();
  const serverRelease = catalog.getRelease("x402-mcp-server@1.0.0");
  const clientRelease = catalog.getRelease("x402-mcp-client@1.0.0");
  if (serverRelease === undefined || clientRelease === undefined) throw new Error("catalog releases missing");
  const releases = [serverRelease, clientRelease];
  const price = BigInt(serverRelease.manifest.priceAtomic);

  const stateDir = join(cfg.workDir, "bridge-state");
  const wsRoot = join(cfg.workDir, "workspaces");
  const logDir = join(cfg.workDir, "logs");
  for (const d of [stateDir, wsRoot, logDir]) mkdirSync(d, { recursive: true });

  const sessions: BridgeSession[] = [];
  const bridgeFor = async (workspace: string, apiUrl: string = cfg.serverUrl) => {
    const env: BridgeEnv = {
      LEMMA_API_URL: apiUrl,
      LEMMA_WORKSPACE: workspace,
      BUYER_PRIVATE_KEY: cfg.buyer.privateKey,
      LEMMA_PROVIDER_ADDRESS: cfg.provider,
      RESOLUTION_WARRANTY_REGISTRY_ADDRESS: registry,
      ARBITRUM_SEPOLIA_RPC_URL: cfg.rpcUrl,
      LEMMA_STATE_DIR: stateDir,
      LEMMA_MAX_USDC_PER_RESOLUTION: "0.25",
      LEMMA_DAILY_USDC_CAP: "1.00",
    };
    const s = await BridgeSession.start(env, logDir);
    sessions.push(s);
    return s;
  };

  const snapshot = async () => {
    const bonds: Record<string, { available: bigint; reserved: bigint }> = {};
    for (const r of releases) {
      const rel = await readRelease(c.pub, registry, r.releaseId);
      bonds[r.manifest.id] = { available: rel.availableBond, reserved: rel.reservedBond };
    }
    return {
      buyerUsdc: await usdcBalance(c.pub, cfg.buyer.address),
      buyerEth: await c.pub.getBalance({ address: cfg.buyer.address }),
      providerUsdc: await usdcBalance(c.pub, cfg.provider),
      registryUsdc: await usdcBalance(c.pub, registry),
      buyerCredit: await readCredit(c.pub, registry, cfg.buyer.address),
      bonds,
    };
  };
  type Snap = Awaited<ReturnType<typeof snapshot>>;
  const showBalances = (s: Snap) => {
    narr.kv("buyer USDC", `${usdc(s.buyerUsdc)}  (${eth(s.buyerEth)} for gas)`);
    narr.kv("provider USDC", usdc(s.providerUsdc));
    narr.kv("registry USDC", usdc(s.registryUsdc));
    for (const [id, b] of Object.entries(s.bonds)) narr.kv(`bond ${id}`, `${usdc(b.available)} available, ${usdc(b.reserved)} reserved`);
    narr.kv("buyer refund credit", usdc(s.buyerCredit));
  };

  const evaluatorCli = (args: string[]) => {
    const r = spawnSync(join(REPO_ROOT, "node_modules", ".bin", "tsx"), [join(REPO_ROOT, "scripts", "evaluator.ts"), ...args, "--dotenv", "none", "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 300_000,
      env: childEnv({
        EVALUATOR_PRIVATE_KEY: cfg.evaluator.privateKey,
        EVALUATOR_ADDRESS: cfg.evaluator.address,
        RESOLUTION_WARRANTY_REGISTRY_ADDRESS: registry,
        ARBITRUM_SEPOLIA_RPC_URL: cfg.rpcUrl,
        LEMMA_API_URL: cfg.serverUrl,
      }),
    });
    if (r.status !== 0) throw new Error(`evaluator CLI failed: ${narr.scrubber.scrub((r.stderr || r.stdout).slice(-1000))}`);
    const line = r.stdout.trim().split("\n").at(-1) ?? "{}";
    return JSON.parse(line) as Record<string, string>;
  };

  const showPreview = (p: PreviewData) => {
    const pv = p.preview;
    narr.kv("decision", `${pv.decision}${pv.release !== null ? `  (${pv.release})` : ""}`);
    if (pv.priceAtomic !== null) narr.kv("price", `${formatUsdc(BigInt(pv.priceAtomic))} USDC`);
    if (pv.warranty !== null) narr.kv("warranty", `coverage ${formatUsdc(BigInt(pv.warranty.bondAtomic))} USDC, claim window ${pv.warranty.claimWindowSeconds / 3600}h`);
    narr.kv("evidence", pv.evidence === null ? "none" : `${pv.evidence.status}${pv.expectedSavingAtomic !== null ? `, expected saving ${formatUsdc(BigInt(pv.expectedSavingAtomic))} USDC` : ""}`);
    narr.kv("provisional override", pv.provisionalOverride ? "YES (LEMMA_ALLOW_PROVISIONAL=true, demo only)" : "no");
    for (const r of pv.reasons.slice(0, 6)) narr.say(`  - ${r}`);
    for (const l of pv.limitations.slice(0, 3)) narr.say(`  limitation: ${l}`);
    narr.kv("local spend policy", p.local.purchaseAllowedByLocalPolicy ? `allows purchase (spent today ${p.local.spentTodayUsdc} / cap ${p.local.dailyCapUsdc} USDC)` : `refuses: ${p.local.policyReasons.join("; ")}`);
  };

  /** preview -> buy through the bridge, with onchain checks. */
  const previewAndBuy = async (
    bridge: BridgeSession,
    kind: string,
    label: string,
    steps?: { preview: [string, string]; buy: [string, string] },
    opts: { expectStatus?: string; beforeBuy?: () => void } = {},
  ) => {
    if (steps !== undefined) narr.step(...steps.preview);
    const pv = await bridge.call<PreviewData>("lemma_preview", { kind });
    if (!pv.ok) throw new Error(`lemma_preview failed: ${pv.error.code} ${pv.error.message}`);
    showPreview(pv.data);
    narr.check(pv.data.preview.purchasable && pv.data.local.purchaseAllowedByLocalPolicy, `${label}: preview is purchasable and within local policy`);
    if (steps !== undefined) narr.step(...steps.buy);
    const before = await snapshot();
    opts.beforeBuy?.();
    const buy = await bridge.call<BuyData>("lemma_buy_resolution", { previewId: pv.data.preview.previewId });
    if (!buy.ok) throw new Error(`lemma_buy_resolution failed: ${buy.error.code} ${buy.error.message}`);
    const b = buy.data;
    narr.kv("resolutionId", b.resolutionId);
    narr.tx(`x402 settlement (buyer -> provider ${formatUsdc(BigInt(b.priceAtomic))} USDC, submitted by facilitator)`, b.paymentHash);
    narr.kv("payload digest", `${b.payloadDigest} (verified by the bridge)`);
    narr.kv("voucher signer", `${b.voucherSigner} (provider, EIP-712 verified by the bridge)`);
    if (b.activation?.txHash != null) narr.tx("warranty activation (buyer -> registry.activateResolution)", b.activation.txHash);
    const expected = opts.expectStatus ?? "purchased";
    narr.check(b.status === expected, `${label}: bridge ${expected === "recovered" ? "recovered the paid resolution via lemma_recover_resolution" : "bought the resolution"} (status ${b.status})`);
    narr.check(b.activation?.status === "activated", `${label}: warranty activation ${b.activation?.status ?? "missing"}${b.activation?.reason ? ` (${b.activation.reason})` : ""}`);
    const settle = await c.pub.getTransactionReceipt({ hash: b.paymentHash });
    narr.check(settle.status === "success" && settle.from.toLowerCase() === cfg.facilitator.toLowerCase(), "settlement mined, sent by the facilitator key");
    const after = await snapshot();
    const p = BigInt(b.priceAtomic);
    narr.check(before.buyerUsdc - after.buyerUsdc === p, `buyer paid exactly ${usdc(p)} (${signedUsdc(after.buyerUsdc - before.buyerUsdc)})`);
    narr.check(after.providerUsdc - before.providerUsdc === p, `provider received exactly ${usdc(p)}`);
    const w = await readWarranty(c.pub, registry, b.resolutionId);
    narr.check(statusName(w.status) === "Active" && w.amount === p && w.paymentHash.toLowerCase() === b.paymentHash.toLowerCase(), `warranty Active onchain, ${usdc(w.amount)} reserved, claim deadline ${new Date(Number(w.claimDeadline) * 1000).toISOString()}`);
    return { preview: pv.data.preview, buy: b };
  };

  const applyAndVerify = async (bridge: BridgeSession, resolutionId: Hex, steps?: { apply: [string, string]; verify: [string, string] }) => {
    if (steps !== undefined) narr.step(...steps.apply);
    const dry = await bridge.call<ApplyData>("lemma_apply_resolution", { resolutionId });
    if (!dry.ok) throw new Error(`dry run failed: ${dry.error.message}`);
    narr.say("dry run (nothing written):");
    for (const ch of dry.data.changes) narr.say(`  ${ch.op.padEnd(6)} ${ch.path}  [${ch.status}]`);
    for (const d of dry.data.dependencyChanges) narr.say(`  dep    package.json ${d.section}: ${d.name}@${d.version}`);
    narr.check(dry.data.dryRun, "dry run wrote nothing");
    const applied = await bridge.call<ApplyData>("lemma_apply_resolution", { resolutionId, apply: true });
    if (!applied.ok) throw new Error(`apply failed: ${applied.error.message}`);
    narr.check(!applied.data.dryRun && applied.data.filesChanged > 0, `applied atomically: ${applied.data.filesChanged} file(s) written`);
    if (steps !== undefined) narr.step(...steps.verify);
    const verify = await bridge.call<VerifyData>("lemma_verify_adoption", { resolutionId });
    if (!verify.ok) throw new Error(`lemma_verify_adoption failed: ${verify.error.code} ${verify.error.message}`);
    const t = verify.data.receipt.testSummary;
    narr.kv("acceptance", `${verify.data.outcome}: ${t.passed} passed, ${t.failed} failed (${t.durationMs} ms)`);
    narr.kv("receipt", verify.data.submitted ? `signed by buyer and accepted (receiptId ${verify.data.receiptId})` : `NOT submitted: ${verify.data.submitError}`);
    narr.kv("evidence digest", verify.data.receipt.evidenceDigest);
    return verify.data;
  };

  const start = await snapshot();
  try {
    // ---------------------------------------------------------------- setup
    narr.step("0", "Setup");
    const status = (await (await fetch(`${cfg.serverUrl}/api/v1/status`)).json()) as Record<string, unknown>;
    narr.kv("Lemma server", cfg.serverUrl);
    narr.kv("registry", narr.explorer.address(registry));
    narr.kv("provider / x402 payTo", cfg.provider);
    narr.kv("facilitator", cfg.facilitator);
    narr.kv("evaluator", cfg.evaluator.address);
    narr.kv("buyer (bridge wallet)", cfg.buyer.address);
    narr.kv("paid tools", JSON.stringify(status.paidTools));
    narr.note("LEMMA_ALLOW_PROVISIONAL=true: releases have provisional (not yet benchmarked) evidence; the server offers them for this demo only.");
    narr.check(status.registry === registry && status.provisionalOverride === true, "server is wired to this registry with the provisional override on");
    showBalances(start);

    // ---------------------------------------------------------------- happy path
    narr.step("1", "Agent task: add x402 payments (Arbitrum Sepolia) to a TypeScript MCP server");
    const wsA = fixtureWorkspace("mcp-server-exact", wsRoot);
    narr.kv("workspace", `${wsA} (copy of catalog fixture mcp-server-exact)`);
    const bridgeA = await bridgeFor(wsA);
    narr.kv("bridge tools", (await bridgeA.tools()).join(", "));

    const happy = await previewAndBuy(bridgeA, TASK_SERVER, "happy path", {
      preview: ["2-3", "Agent calls lemma_preview before writing code (free): typed match, price, warranty, limitations"],
      buy: ["4-5", "lemma_buy_resolution: local cap check -> x402 payment -> digest + voucher check -> warranty activation"],
    });
    const again = await bridgeA.call<BuyData>("lemma_buy_resolution", { previewId: happy.preview.previewId });
    const afterAgain = await usdcBalance(c.pub, cfg.buyer.address);
    narr.check(again.ok && again.data.status === "already-owned" && afterAgain === start.buyerUsdc - price, "repeat buy returns the owned resolution without a second payment");

    const adoptA = await applyAndVerify(bridgeA, happy.buy.resolutionId, {
      apply: ["6", "lemma_apply_resolution: dry run, then apply"],
      verify: ["7", "lemma_verify_adoption: acceptance recipe + buyer-signed Adoption Receipt"],
    });
    narr.check(adoptA.outcome === "passed" && adoptA.submitted, "acceptance passed and the server accepted the receipt");
    const receipts = (await (await fetch(`${cfg.serverUrl}/api/v1/adoption-receipts?resolutionId=${happy.buy.resolutionId}`)).json()) as { receipts: Array<{ outcome: string }> };
    narr.check(receipts.receipts.at(-1)?.outcome === "passed", "dashboard API lists the passed receipt");

    narr.step("8", "Evaluator attests Passed -> reserved bond released back to the provider");
    const bondBeforePass = (await readRelease(c.pub, registry, serverRelease.releaseId));
    const pass = evaluatorCli(["finalize", "--resolution", happy.buy.resolutionId, "--result", "passed", "--yes"]);
    narr.tx("finalizeOutcome(Passed) signed with the EVALUATOR key", pass.txHash as string);
    const bondAfterPass = await readRelease(c.pub, registry, serverRelease.releaseId);
    narr.check(pass.status === "Passed", "warranty status Passed");
    narr.check(bondAfterPass.reservedBond === bondBeforePass.reservedBond - price && bondAfterPass.availableBond === bondBeforePass.availableBond + price, `reserve released: available ${usdc(bondBeforePass.availableBond)} -> ${usdc(bondAfterPass.availableBond)}`);
    const summary = (await (await fetch(`${cfg.serverUrl}/api/v1/resolutions/${happy.buy.resolutionId}`)).json()) as Record<string, unknown>;
    narr.kv("dashboard resolution", JSON.stringify({ status: summary.status, receipts: summary.receipts }));

    // ---------------------------------------------------------------- no-match
    narr.step("9", "Incompatible repositories: free no-match, zero payment");
    for (const fixture of ["python-service", "express-no-mcp"]) {
      const ws = fixtureWorkspace(fixture, wsRoot);
      const bridge = await bridgeFor(ws);
      const before = await usdcBalance(c.pub, cfg.buyer.address);
      const pv = await bridge.call<PreviewData>("lemma_preview", { kind: TASK_SERVER });
      if (!pv.ok) throw new Error(`preview failed: ${pv.error.message}`);
      narr.say(`${fixture}:`);
      showPreview(pv.data);
      narr.check(pv.data.preview.decision === "decline" && !pv.data.preview.purchasable && pv.data.preview.priceAtomic === null, `${fixture}: decline, no price, nothing to buy`);
      const refused = await bridge.call("lemma_buy_resolution", { previewId: pv.data.preview.previewId });
      narr.check(!refused.ok && refused.error.code === "policy", `${fixture}: buy attempt refused locally (${refused.ok ? "?" : refused.error.message})`);
      narr.check((await usdcBalance(c.pub, cfg.buyer.address)) === before, `${fixture}: 0 USDC spent`);
    }

    // ---------------------------------------------------------------- failure
    narr.step("10", "Prepared failure: warranty pays the buyer from the provider bond");
    const wsF = preparedFailureWorkspace(wsRoot);
    narr.kv("workspace", `${wsF}`);
    narr.note("PREPARED FAILURE: this workspace's own vitest harness stubs @x402/mcp, so the pinned acceptance recipe fails after a correct apply. The profile still matches, so Lemma sells it.");
    const proxy = cfg.faultProxy;
    const bridgeF = await bridgeFor(wsF, proxy?.url ?? cfg.serverUrl);
    if (proxy !== undefined) narr.note(`INJECTED FAULT: this bridge talks to the server through ${proxy.url}, which drops the paid purchase response after settlement.`);
    const failed = await previewAndBuy(bridgeF, TASK_SERVER, "failure path", undefined, {
      ...(proxy !== undefined ? { expectStatus: "recovered", beforeBuy: () => proxy.dropNextPaidResponse() } : {}),
    });
    if (proxy !== undefined) narr.check(proxy.dropped === 1, "the paid response was dropped once; the buyer still paid exactly once (checked above)");
    const adoptF = await applyAndVerify(bridgeF, failed.buy.resolutionId);
    narr.check(adoptF.outcome === "failed" && adoptF.submitted, "acceptance failed and the buyer's signed failed receipt was accepted");
    const preFail = await snapshot();
    const fail = evaluatorCli(["finalize", "--resolution", failed.buy.resolutionId, "--result", "failed", "--yes"]);
    narr.tx("finalizeOutcome(Failed) signed with the EVALUATOR key", fail.txHash as string);
    const postFail = await snapshot();
    narr.check(fail.status === "Failed", "warranty status Failed");
    narr.check(postFail.buyerCredit - preFail.buyerCredit === price, `buyer credit ${usdc(preFail.buyerCredit)} -> ${usdc(postFail.buyerCredit)} (from the provider's reserved bond)`);
    const wd = await c.wallet(cfg.buyer.account).writeContract({ address: registry, abi: REGISTRY_ABI, functionName: "withdrawCredit" });
    await mined(c.pub, wd);
    narr.tx("buyer withdrawCredit()", wd);
    const postWithdraw = await snapshot();
    narr.check(postWithdraw.buyerUsdc - postFail.buyerUsdc === postFail.buyerCredit && postWithdraw.buyerCredit === 0n, `buyer USDC ${usdc(postFail.buyerUsdc)} -> ${usdc(postWithdraw.buyerUsdc)} (${signedUsdc(postWithdraw.buyerUsdc - postFail.buyerUsdc)} refund)`);
    narr.say(`failed resolution net cost to the buyer: ${signedUsdc(postWithdraw.buyerUsdc - (preFail.buyerUsdc + price))} (paid ${usdc(price)}, refunded ${usdc(price)}; gas excluded)`);

    // ---------------------------------------------------------------- benchmark
    narr.step("11", "Frozen control vs treatment benchmark");
    const bench = (await (await fetch(`${cfg.serverUrl}/api/v1/benchmarks`)).json()) as { status: string };
    narr.kv("GET /api/v1/benchmarks", bench.status);
    narr.say("The paired benchmark is produced by `npm run benchmark` (packages/benchmark) and shown on the dashboard.");

    // ---------------------------------------------------------------- expiry
    if (cfg.timeTravel !== undefined) {
      narr.step("A", "Appendix (fork only): unresolved warranty expires after the claim window");
      const wsC = fixtureWorkspace("mcp-client-exact", wsRoot);
      const bridgeC = await bridgeFor(wsC);
      const expiring = await previewAndBuy(bridgeC, TASK_CLIENT, "client release");
      const window = clientRelease.manifest.claimWindowSeconds;
      await cfg.timeTravel(window + 60);
      narr.say(`advanced fork time by ${window + 60}s`);
      const exp = evaluatorCli(["expire", "--resolution", expiring.buy.resolutionId, "--yes"]);
      narr.tx("expireResolution", exp.txHash as string);
      const rel = await readRelease(c.pub, registry, clientRelease.releaseId);
      narr.check(exp.status === "Expired" && rel.reservedBond === 0n, `warranty Expired; ${clientRelease.manifest.id} reserve released (${usdc(rel.availableBond)} available)`);
    } else {
      narr.step("A", "Expiry");
      narr.say("Unresolved warranties can be expired after their claim window with:");
      narr.say("  npm run evaluator -- expire --resolution <resolutionId> --yes");
    }
  } finally {
    for (const s of sessions) await s.close();
  }

  // ---------------------------------------------------------------- summary
  const end = await snapshot();
  narr.step("summary", "Balances before -> after");
  const row = (label: string, a: bigint, b: bigint) => narr.kv(label, `${usdc(a)} -> ${usdc(b)}  (${signedUsdc(b - a)})`);
  row("buyer USDC", start.buyerUsdc, end.buyerUsdc);
  row("provider USDC", start.providerUsdc, end.providerUsdc);
  row("registry USDC", start.registryUsdc, end.registryUsdc);
  for (const r of releases) {
    const id = r.manifest.id;
    const s = start.bonds[id];
    const e = end.bonds[id];
    if (s !== undefined && e !== undefined) narr.kv(`bond ${id}`, `available ${usdc(s.available)} -> ${usdc(e.available)}, reserved ${usdc(s.reserved)} -> ${usdc(e.reserved)}`);
  }
  const totals = await Promise.all(
    (["totalAvailableBond", "totalReservedBond", "totalCredits"] as const).map((fn) => c.pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: fn })),
  );
  const owed = totals.reduce((a, b) => a + b, 0n);
  narr.check(end.registryUsdc >= owed, `registry solvent: holds ${usdc(end.registryUsdc)} >= available + reserved + credits ${usdc(owed)}`);
  narr.say("");
  narr.say(`${narr.txs.length} transactions:`);
  for (const t of narr.txs) narr.say(`  ${t.label}: ${t.hash}`);
}

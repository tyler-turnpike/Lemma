import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Catalog } from "@lemma/catalog";
import type { AcceptanceRecipe } from "@lemma/core";
import { runAcceptance } from "@lemma/core/node";

import { countToolCalls, extractLemmaPayment, runAgent, type AgentResult } from "./agent.js";
import { codexBinary, codexOptions, threadOptions, type CodexRunConfig } from "./codex-config.js";
import { FROZEN_AGENT } from "./config.js";
import { estimateCost } from "./cost.js";
import type { PlannedRun } from "./matrix.js";
import { bridgeEntrypoint, harnessParent } from "./paths.js";
import { buildPrompt } from "./prompts.js";
import { RunRecord, type RunError } from "./schema.js";
import { knownSecrets, scrubForPersistence } from "./secrets.js";
import { getTask, type BenchmarkTask } from "./tasks.js";
import { diffSnapshots, prepareWorkspace, snapshot } from "./workspace.js";

export type RunContext = {
  experimentVersion: string;
  series: "final" | "exploratory";
  catalog: Catalog;
  /** Benchmark environment (from .env); never copied into process.env. */
  env: Record<string, string>;
  /** Directory for this series' raw records, e.g. runs/lemma-bench-v1. */
  outDir: string;
  keepWorkspace?: boolean;
  log?: (line: string) => void;
};

export function recipeFor(task: BenchmarkTask, catalog: Catalog): AcceptanceRecipe {
  if (task.recipe !== undefined) return task.recipe;
  const release = catalog.getRelease(task.acceptance.kind === "release" ? task.acceptance.release : task.release);
  if (release === undefined) throw new Error(`unknown release for task ${task.id}`);
  return release.manifest.acceptance;
}

/** Problems that prevent a treatment run from starting. Checked before any API spend. */
export function treatmentPreflight(env: Record<string, string>): string[] {
  const problems: string[] = [];
  if (!env.LEMMA_API_URL) problems.push("LEMMA_API_URL is not set");
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.BENCHMARK_BUYER_PRIVATE_KEY ?? "")) problems.push("BENCHMARK_BUYER_PRIVATE_KEY is missing or malformed");
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.LEMMA_PROVIDER_ADDRESS ?? "")) problems.push("LEMMA_PROVIDER_ADDRESS is missing or malformed");
  if (!existsSync(bridgeEntrypoint())) problems.push("apps/bridge/dist/index.js is missing (run npm run build -w @lemma/bridge)");
  return problems;
}

/**
 * Network preflight for --run: the hosted server must be healthy, have paid tools enabled, NOT
 * override the pricing rule (so every treatment purchase is one the rule permits on its own), and
 * name the provider the bridge expects.
 */
export async function serverPreflight(apiUrl: string, providerAddress: string, timeoutMs = 10_000): Promise<string[]> {
  const base = apiUrl.replace(/\/+$/, "");
  try {
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!health.ok) return [`${base}/health returned HTTP ${health.status}`];
    const status = (await (await fetch(`${base}/api/v1/status`, { signal: AbortSignal.timeout(timeoutMs) })).json()) as {
      paidTools?: { enabled?: boolean; reason?: string | null };
      provisionalOverride?: boolean;
      provider?: string | null;
    };
    const problems: string[] = [];
    if (status.paidTools?.enabled !== true) problems.push(`server paid tools are disabled (${status.paidTools?.reason ?? "no reason given"})`);
    if (status.provisionalOverride === true) problems.push("server overrides the pricing rule (unset LEMMA_ALLOW_PROVISIONAL so the benchmark measures releases sold under the rule)");
    if (typeof status.provider !== "string" || status.provider.toLowerCase() !== providerAddress.toLowerCase()) problems.push("server provider address does not match LEMMA_PROVIDER_ADDRESS");
    return problems;
  } catch (e) {
    return [`${base} is unreachable (${e instanceof Error ? e.message : String(e)})`];
  }
}

/** Executes one planned run end to end and writes its scrubbed record. Never throws for agent failures. */
export async function executeRun(planned: PlannedRun, ctx: RunContext): Promise<RunRecord> {
  const log = ctx.log ?? (() => undefined);
  const task = getTask(planned.taskId);
  const prompt = buildPrompt(task, planned.arm);
  const apiKey = ctx.env.OPENAI_API_KEY ?? "";
  const secrets = knownSecrets(ctx.env, [apiKey]);
  const startedAt = new Date();
  mkdirSync(harnessParent(), { recursive: true, mode: 0o700 });
  const harnessDir = mkdtempSync(join(harnessParent(), "h-"));
  chmodSync(harnessDir, 0o700);
  const codexHome = join(harnessDir, "codex-home");
  mkdirSync(codexHome, { mode: 0o700 });
  const agentHome = mkdtempSync(join(tmpdir(), "lemma-bench-home-"));
  const ws = prepareWorkspace(task, ctx.catalog);
  const recipe = recipeFor(task, ctx.catalog);
  let agent: AgentResult = { threadId: null, items: [], finalMessage: "", tokens: { input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoning: null, total: 0, reported: false }, durationMs: 0, error: null };
  let harnessError: RunError | null = null;

  try {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    const cfg: CodexRunConfig = { arm: planned.arm, workspace: ws.dir, harnessDir, codexHome, agentHome, codexPath: codexBinary(), apiKey };
    if (planned.arm === "treatment") {
      const problems = treatmentPreflight(ctx.env);
      if (problems.length > 0) throw new Error(`treatment preflight failed: ${problems.join("; ")}`);
      const secretsDir = join(harnessDir, "secrets");
      mkdirSync(secretsDir, { mode: 0o700 });
      const secretsFile = join(secretsDir, "bridge.json");
      const bridgeSecrets: Record<string, string> = { BUYER_PRIVATE_KEY: ctx.env.BENCHMARK_BUYER_PRIVATE_KEY ?? "" };
      if (ctx.env.ARBITRUM_SEPOLIA_RPC_URL) bridgeSecrets.ARBITRUM_SEPOLIA_RPC_URL = ctx.env.ARBITRUM_SEPOLIA_RPC_URL;
      writeFileSync(secretsFile, JSON.stringify(bridgeSecrets), { mode: 0o600 });
      const stateDir = join(ctx.outDir, "bridge-state");
      mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      cfg.bridge = {
        apiUrl: ctx.env.LEMMA_API_URL ?? "",
        stateDir,
        secretsFile,
        providerAddress: ctx.env.LEMMA_PROVIDER_ADDRESS ?? "",
        ...(ctx.env.USDC_ADDRESS ? { usdcAddress: ctx.env.USDC_ADDRESS } : {}),
        ...(ctx.env.RESOLUTION_WARRANTY_REGISTRY_ADDRESS ? { registryAddress: ctx.env.RESOLUTION_WARRANTY_REGISTRY_ADDRESS } : {}),
      };
    }
    const before = snapshot(ws.dir);
    log(`[${planned.runId}] agent started (${FROZEN_AGENT.model}, budget ${FROZEN_AGENT.timeBudgetMs / 60000} min)`);
    agent = await runAgent(codexOptions(cfg), threadOptions(ws.dir), prompt, FROZEN_AGENT.timeBudgetMs);
    log(`[${planned.runId}] agent finished in ${agent.durationMs} ms${agent.error ? ` with ${agent.error.phase} error` : ""}`);

    const after = snapshot(ws.dir);
    const filesChanged = diffSnapshots(before, after);

    // The acceptance test is the definition of done: restore its original bytes if the agent touched it.
    const testFile = join(ws.dir, ...task.acceptance.testPath.split("/"));
    const current = existsSync(testFile) ? new Uint8Array(readFileSync(testFile)) : null;
    const testTampered = current === null || Buffer.compare(Buffer.from(current), Buffer.from(ws.testBytes)) !== 0;
    if (testTampered) {
      mkdirSync(join(testFile, ".."), { recursive: true });
      writeFileSync(testFile, ws.testBytes);
    }
    const acceptanceEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: agentHome, LANG: "C.UTF-8", CI: "1" };
    if (process.env.TMPDIR) acceptanceEnv.TMPDIR = process.env.TMPDIR;
    log(`[${planned.runId}] running acceptance`);
    const acc = await runAcceptance(ws.dir, recipe, { env: acceptanceEnv });
    log(`[${planned.runId}] acceptance ${acc.passed ? "passed" : "failed"}`);

    const lemma = planned.arm === "treatment" ? extractLemmaPayment(agent.items) : null;
    const priceAtomic = lemma?.purchased && lemma.priceAtomic !== null ? BigInt(lemma.priceAtomic) : 0n;
    const endedAt = new Date();
    const record: RunRecord = {
      schemaVersion: "1",
      experimentVersion: ctx.experimentVersion,
      series: ctx.series,
      runId: planned.runId,
      arm: planned.arm,
      taskId: task.id,
      match: task.match,
      repetition: planned.repetition,
      matrixIndex: planned.matrixIndex,
      agent: { ...FROZEN_AGENT },
      promptSha256: createHash("sha256").update(prompt).digest("hex"),
      fixture: { id: task.fixtureId, digest: ws.fixtureDigest },
      threadId: agent.threadId,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      agentDurationMs: agent.durationMs,
      tokens: agent.tokens,
      cost: estimateCost(FROZEN_AGENT.model, agent.tokens, priceAtomic),
      toolCalls: countToolCalls(agent.items),
      filesChanged,
      acceptance: {
        ran: true,
        passed: acc.passed,
        testPath: task.acceptance.testPath,
        argv: recipe.argv,
        durationMs: acc.durationMs,
        exitCodes: acc.steps.map((s) => s.exitCode),
        timedOut: acc.steps.some((s) => s.timedOut),
        testTampered,
        outputTail: acc.steps.map((s) => s.output).join("\n").slice(-4000),
      },
      interventions: { count: 0, mode: "automated" },
      lemma,
      error: agent.error,
      finalMessage: agent.finalMessage.slice(0, 4000),
    };
    return persist(record, ctx, secrets);
  } catch (e) {
    harnessError = { phase: agent.threadId === null ? "startup" : "harness", message: e instanceof Error ? e.message : String(e) };
    const endedAt = new Date();
    const record: RunRecord = {
      schemaVersion: "1",
      experimentVersion: ctx.experimentVersion,
      series: ctx.series,
      runId: planned.runId,
      arm: planned.arm,
      taskId: task.id,
      match: task.match,
      repetition: planned.repetition,
      matrixIndex: planned.matrixIndex,
      agent: { ...FROZEN_AGENT },
      promptSha256: createHash("sha256").update(prompt).digest("hex"),
      fixture: { id: task.fixtureId, digest: ws.fixtureDigest },
      threadId: agent.threadId,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      agentDurationMs: agent.durationMs,
      tokens: agent.tokens,
      cost: estimateCost(FROZEN_AGENT.model, agent.tokens),
      toolCalls: countToolCalls(agent.items),
      filesChanged: { added: [], modified: [], deleted: [], count: 0 },
      acceptance: { ran: false, passed: false, testPath: task.acceptance.testPath, argv: recipe.argv, durationMs: 0, exitCodes: [], timedOut: false, testTampered: false, outputTail: "" },
      interventions: { count: 0, mode: "automated" },
      lemma: planned.arm === "treatment" ? extractLemmaPayment(agent.items) : null,
      error: harnessError,
      finalMessage: agent.finalMessage.slice(0, 4000),
    };
    return persist(record, ctx, secrets);
  } finally {
    // Secrets file and CODEX_HOME go first, unconditionally.
    rmSync(harnessDir, { recursive: true, force: true });
    rmSync(agentHome, { recursive: true, force: true });
    if (!ctx.keepWorkspace) rmSync(ws.dir, { recursive: true, force: true });
    else log(`[${planned.runId}] workspace kept at ${ws.dir}`);
  }
}

/** Redacts, validates and writes a record. Public 32-byte hashes in the payment block are kept. */
export function persist(record: RunRecord, ctx: Pick<RunContext, "outDir">, secrets: readonly string[]): RunRecord {
  const allowHex = [record.lemma?.paymentHash, record.lemma?.warrantyTxHash].filter((h): h is string => typeof h === "string");
  const clean = RunRecord.parse(scrubForPersistence(record, secrets, allowHex));
  mkdirSync(ctx.outDir, { recursive: true });
  writeFileSync(join(ctx.outDir, `${clean.runId}.json`), `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
  return clean;
}

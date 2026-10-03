import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadCatalog } from "@lemma/catalog";

import { EXPERIMENT_VERSION, EXPLORATORY_DIR, FROZEN_AGENT, PRICE_TABLE } from "./config.js";
import { formatPlan, planMatrix, type PlannedRun } from "./matrix.js";
import { publishedAggregatePath, repoRoot, runsDir } from "./paths.js";
import { buildAggregate, readRecords } from "./report.js";
import { executeRun, serverPreflight, treatmentPreflight } from "./runner.js";
import type { Arm, RunRecord } from "./schema.js";
import { benchmarkEnv, knownSecrets } from "./secrets.js";

const MODES = ["plan", "smoke", "run", "report"] as const;
type Mode = (typeof MODES)[number];

export type CliArgs = { mode: Mode | null; confirm: boolean; keepWorkspace: boolean; experiment: string; envFile: string; publish: boolean; arm: Arm; budgetUsd: number | null };

/** Parses flags (the root script forwards them with `npm run benchmark -w @lemma/benchmark --`). */
export function parseArgs(argv: readonly string[]): CliArgs {
  const flags = new Set(argv.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")[0]!));
  const value = (name: string) => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq !== undefined) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const modes = MODES.filter((m) => flags.has(m));
  if (modes.length > 1) throw new Error(`choose one of ${MODES.map((m) => `--${m}`).join(", ")}`);
  const arm = value("arm") ?? "control";
  if (arm !== "control" && arm !== "treatment") throw new Error("--arm must be control or treatment");
  if (flags.has("arm") && modes[0] !== "smoke") throw new Error("--arm applies to --smoke only");
  const budget = value("budget-usd");
  const budgetUsd = budget === undefined ? null : Number(budget);
  if (budgetUsd !== null && !(Number.isFinite(budgetUsd) && budgetUsd > 0)) throw new Error("--budget-usd must be a positive number");
  return {
    budgetUsd,
    arm,
    mode: modes[0] ?? null,
    confirm: flags.has("confirm"),
    keepWorkspace: flags.has("keep-workspace"),
    experiment: value("experiment") ?? EXPERIMENT_VERSION,
    envFile: value("env-file") ?? join(repoRoot(), ".env"),
    publish: !flags.has("no-publish"),
  };
}

const USAGE = `Usage: npm run benchmark -- <mode>
  --plan               print the frozen 20-run matrix (no API calls)
  --smoke              one run on one task to validate the harness (spends a little; exploratory, never aggregated)
                       --arm treatment smokes the Lemma arm: live server, bridge and one real testnet purchase
  --run --confirm      execute the full matrix (needs the live Lemma server and a funded buyer wallet for treatment)
  --report             aggregate final records and write published/aggregate.json (--no-publish to skip writing)
Options: --experiment <id> (default ${EXPERIMENT_VERSION}), --env-file <path>, --keep-workspace,
         --budget-usd <n>  (--run) stop before a run when estimated model spend this invocation plus the costliest run so far would exceed n`;

function describeRecord(r: RunRecord): string {
  return [
    `run ${r.runId}`,
    `  arm=${r.arm} task=${r.taskId} model=${r.agent.model} effort=${r.agent.modelReasoningEffort}`,
    `  tokens: input ${r.tokens.input} (cached ${r.tokens.cachedInput}), output ${r.tokens.output} (reasoning ${r.tokens.reasoning ?? "n/a"}), total ${r.tokens.total}`,
    `  estimated raw model cost: $${r.cost.rawModelUsd.toFixed(4)} (${r.cost.label}); all-in $${r.cost.allInUsd.toFixed(4)}`,
    `  duration ${(r.durationMs / 1000).toFixed(1)} s (agent ${(r.agentDurationMs / 1000).toFixed(1)} s); tool calls ${r.toolCalls.total} (commands ${r.toolCalls.commands}, file changes ${r.toolCalls.fileChanges}, mcp ${r.toolCalls.mcp}, web ${r.toolCalls.webSearches})`,
    `  files changed ${r.filesChanged.count}: +${r.filesChanged.added.join(", +") || "-"} ~${r.filesChanged.modified.join(", ~") || "-"}`,
    `  acceptance: ${r.acceptance.passed ? "PASS" : "FAIL"}${r.acceptance.testTampered ? " (test file was modified by the agent and restored)" : ""}`,
    `  error: ${r.error ? `${r.error.phase}: ${r.error.message.slice(0, 300)}` : "none"}`,
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const log = (line: string) => process.stdout.write(`${line}\n`);

  if (args.mode === null) {
    log(USAGE);
    return 1;
  }

  if (args.mode === "plan") {
    log(`experiment ${args.experiment}; model ${FROZEN_AGENT.model} (${FROZEN_AGENT.modelReasoningEffort}); runtime ${FROZEN_AGENT.runtime}`);
    log(`sandbox ${FROZEN_AGENT.sandbox}; shell network ${FROZEN_AGENT.shellNetworkAccess ? "on" : "off"}; web search ${FROZEN_AGENT.webSearchMode}; budget ${FROZEN_AGENT.timeBudgetMs / 60000} min/run`);
    log(`cost: ${PRICE_TABLE.label} from ${PRICE_TABLE.source}\n`);
    log(formatPlan(planMatrix(args.experiment)));
    return 0;
  }

  if (args.mode === "report") {
    const records = readRecords(join(runsDir(), args.experiment));
    const aggregate = buildAggregate(records, args.experiment);
    const serialized = `${JSON.stringify(aggregate, null, 2)}\n`;
    const env = benchmarkEnv(args.envFile);
    for (const s of knownSecrets(env)) if (serialized.includes(s)) throw new Error("aggregate contains a known secret; refusing to publish");
    if (serialized.includes(repoRoot()) || serialized.includes("/tmp/")) throw new Error("aggregate contains a filesystem path; refusing to publish");
    log(`${aggregate.recordedRuns}/${aggregate.plannedRuns} runs; verdict ${aggregate.verdict}`);
    log(aggregate.summary);
    if (args.publish && aggregate.recordedRuns > 0) {
      const out = publishedAggregatePath();
      mkdirSync(join(out, ".."), { recursive: true });
      writeFileSync(out, serialized);
      log(`wrote ${out}`);
    } else if (aggregate.recordedRuns === 0) {
      log("no final records; nothing published");
    }
    return 0;
  }

  const env = benchmarkEnv(args.envFile);
  if (!env.OPENAI_API_KEY) {
    log(`OPENAI_API_KEY is not set (looked in ${args.envFile} and the environment)`);
    return 1;
  }
  const catalog = loadCatalog();

  if (args.mode === "smoke") {
    if (args.arm === "treatment") {
      const problems = treatmentPreflight(env);
      if (problems.length === 0) problems.push(...(await serverPreflight(env.LEMMA_API_URL!, env.LEMMA_PROVIDER_ADDRESS!)));
      if (problems.length > 0) {
        log(`treatment preflight failed; no run started:\n- ${problems.join("\n- ")}`);
        return 1;
      }
    }
    const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const planned: PlannedRun = {
      matrixIndex: 0,
      runId: `smoke-${stamp}-mcp-server-paywall-exact-${args.arm}`,
      taskId: "mcp-server-paywall-exact",
      match: "matched",
      fixtureId: "mcp-server-exact",
      arm: args.arm,
      repetition: 1,
    };
    const outDir = join(runsDir(), EXPLORATORY_DIR, args.experiment);
    const record = await executeRun(planned, { experimentVersion: args.experiment, series: "exploratory", catalog, env, outDir, keepWorkspace: args.keepWorkspace, log });
    log(describeRecord(record));
    if (record.lemma !== null) log(`  lemma: ${JSON.stringify(record.lemma)}`);
    log(`record: ${join(outDir, `${record.runId}.json`)}`);
    return record.error?.phase === "startup" ? 1 : 0;
  }

  // --run
  const plan = planMatrix(args.experiment);
  if (!args.confirm) {
    log(`--run executes ${plan.length} paid agent runs. Re-run with --run --confirm to proceed.`);
    return 1;
  }
  const problems = treatmentPreflight(env);
  if (problems.length === 0) problems.push(...(await serverPreflight(env.LEMMA_API_URL!, env.LEMMA_PROVIDER_ADDRESS!)));
  if (problems.length > 0) {
    log(`treatment preflight failed; no runs started:\n- ${problems.join("\n- ")}`);
    return 1;
  }
  const outDir = join(runsDir(), args.experiment);
  let exit = 0;
  let spentUsd = 0;
  let costliestUsd = 0;
  for (const planned of plan) {
    if (existsSync(join(outDir, `${planned.runId}.json`))) {
      log(`[${planned.runId}] already recorded; kept as is`);
      continue;
    }
    if (args.budgetUsd !== null && spentUsd + costliestUsd > args.budgetUsd) {
      log(`budget stop: spent ~$${spentUsd.toFixed(4)} of $${args.budgetUsd.toFixed(2)}; the next run could exceed it. Remaining runs not started.`);
      return 2;
    }
    const record = await executeRun(planned, { experimentVersion: args.experiment, series: "final", catalog, env, outDir, keepWorkspace: args.keepWorkspace, log });
    spentUsd += record.cost.rawModelUsd;
    costliestUsd = Math.max(costliestUsd, record.cost.rawModelUsd);
    log(`${describeRecord(record)}\n  model spend this invocation ~$${spentUsd.toFixed(4)}`);
    if (record.error?.phase === "startup") exit = 1;
  }
  return exit;
}

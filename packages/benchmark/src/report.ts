import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FROZEN_AGENT, PRICE_TABLE, SUCCESS_CRITERIA } from "./config.js";
import { planMatrix } from "./matrix.js";
import { Aggregate, RunRecord, type Arm } from "./schema.js";
import { TASKS } from "./tasks.js";

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** 1 - treatment / control. Positive means treatment is cheaper. Null if undefined. */
export function reduction(control: number | null, treatment: number | null): number | null {
  if (control === null || treatment === null || control <= 0) return null;
  return Math.round((1 - treatment / control) * 10_000) / 10_000;
}

type ArmSummary = Aggregate["matched"]["control"];

export function summarizeArm(records: readonly RunRecord[]): ArmSummary {
  const passed = records.filter((r) => r.acceptance.passed).length;
  const spendAtomic = records.reduce((acc, r) => acc + (r.lemma?.purchased && r.lemma.priceAtomic ? BigInt(r.lemma.priceAtomic) : 0n), 0n);
  return {
    runs: records.length,
    passed,
    passRate: records.length === 0 ? 0 : Math.round((passed / records.length) * 10_000) / 10_000,
    medianAllInUsd: median(records.map((r) => r.cost.allInUsd)),
    medianRawModelUsd: median(records.map((r) => r.cost.rawModelUsd)),
    medianTotalTokens: median(records.map((r) => r.tokens.total)),
    medianDurationMs: median(records.map((r) => r.durationMs)),
    lemmaSpendUsd: Number(spendAtomic) / 1_000_000,
    startupFailures: records.filter((r) => r.error?.phase === "startup").length,
    runFailures: records.filter((r) => r.error !== null && r.error.phase !== "startup").length,
  };
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

/**
 * Builds the publishable aggregate from final-series records only. Every run is kept (failures
 * included); costs are medians over all runs of an arm, so a failed run counts with what it spent.
 */
export function buildAggregate(records: readonly RunRecord[], experimentVersion: string, now = new Date()): Aggregate {
  const final = records.filter((r) => r.series === "final" && r.experimentVersion === experimentVersion);
  const plan = planMatrix(experimentVersion);
  const pick = (match: "matched" | "no-match", arm: Arm, taskId?: string) => final.filter((r) => r.match === match && r.arm === arm && (taskId === undefined || r.taskId === taskId));

  const matched = { control: summarizeArm(pick("matched", "control")), treatment: summarizeArm(pick("matched", "treatment")) };
  const noMatchTreatment = pick("no-match", "treatment");
  const noMatchSpendAtomic = noMatchTreatment.reduce((acc, r) => acc + (r.lemma?.purchased && r.lemma.priceAtomic ? BigInt(r.lemma.priceAtomic) : 0n), 0n);
  const noMatch = { control: summarizeArm(pick("no-match", "control")), treatment: summarizeArm(noMatchTreatment), treatmentUsdcSpentAtomic: noMatchSpendAtomic.toString() };

  const reductions = {
    allInCost: reduction(matched.control.medianAllInUsd, matched.treatment.medianAllInUsd),
    totalTokens: reduction(matched.control.medianTotalTokens, matched.treatment.medianTotalTokens),
  };
  const recordedIds = new Set(final.map((r) => r.runId));
  const complete = plan.every((p) => recordedIds.has(p.runId));

  // Correctness: per task, the treatment arm must pass at least as often as control, in matched and no-match tasks.
  const perTask = TASKS.map((t) => ({
    taskId: t.id,
    match: t.match,
    control: summarizeArm(pick(t.match, "control", t.id)),
    treatment: summarizeArm(pick(t.match, "treatment", t.id)),
  }));
  const noCorrectnessRegression = perTask.every((t) => t.treatment.passed / Math.max(t.treatment.runs, 1) >= t.control.passed / Math.max(t.control.runs, 1)) && final.length > 0;
  const criteria = {
    costTargetMet: reductions.allInCost !== null && reductions.allInCost >= SUCCESS_CRITERIA.minCostReduction,
    tokenTargetMet: reductions.totalTokens !== null && reductions.totalTokens >= SUCCESS_CRITERIA.minTokenReduction,
    noCorrectnessRegression,
    noMatchZeroSpend: noMatchSpendAtomic === 0n && noMatchTreatment.length > 0,
    allMet: false,
  };
  criteria.allMet = criteria.costTargetMet && criteria.tokenTargetMet && criteria.noCorrectnessRegression && criteria.noMatchZeroSpend;
  const verdict: Aggregate["verdict"] = !complete ? "incomplete" : criteria.allMet ? "validated" : "not-validated";

  return Aggregate.parse({
    schemaVersion: "1",
    experimentVersion,
    generatedAt: now.toISOString(),
    model: FROZEN_AGENT.model,
    runtime: FROZEN_AGENT.runtime,
    costLabel: `Estimated raw model cost from frozen list prices (${PRICE_TABLE.source}); not charged amounts.`,
    plannedRuns: plan.length,
    recordedRuns: final.length,
    complete,
    matched,
    noMatch,
    reductions,
    perTask,
    criteria,
    verdict,
    summary: summaryText(verdict, reductions, matched, criteria, final.length, plan.length),
    limitations: [
      "Costs are estimates from a frozen list-price table, not provider-charged amounts; token counts are the independent measure.",
      `The model (${FROZEN_AGENT.model}) is a provider alias, not a dated snapshot; provider-side updates during the run window are not controlled.`,
      "Three repetitions per arm and three matched tasks: medians are indicative, not statistically powered.",
      "Matched tasks come from Lemma's own catalog fixtures; results do not generalize to arbitrary repositories.",
      "Lemma price is counted at par (1 USDC = 1 USD, testnet). Warranty activation gas is testnet ETH and excluded from all-in cost.",
      "Boundary fixtures execute against the repository's installed dependency versions, not the older versions they declare.",
    ],
  });
}

export function summaryText(
  verdict: Aggregate["verdict"],
  reductions: Aggregate["reductions"],
  matched: Aggregate["matched"],
  criteria: Aggregate["criteria"],
  recorded: number,
  planned: number,
): string {
  const measured = `Treatment median all-in cost ${pct(reductions.allInCost)} lower and median total tokens ${pct(reductions.totalTokens)} lower than control on matched tasks; pass rates ${pct(matched.control.passRate)} control vs ${pct(matched.treatment.passRate)} treatment.`;
  if (verdict === "incomplete") {
    return `Incomplete: ${recorded} of ${planned} planned runs recorded. No savings claim is made from a partial matrix. ${recorded > 0 ? `Partial measurement: ${measured}` : ""}`.trim();
  }
  if (verdict === "validated") return `Validated against the pre-registered 25% target. ${measured}`;
  const missed: string[] = [];
  if (!criteria.costTargetMet) missed.push("the 25% all-in cost reduction target");
  if (!criteria.tokenTargetMet) missed.push("the 25% total-token reduction target");
  if (!criteria.noCorrectnessRegression) missed.push("no correctness regression");
  if (!criteria.noMatchZeroSpend) missed.push("zero spend on the no-match task");
  return `Not validated: the experiment missed ${missed.join(", ")}. Savings are not claimed. Measured result: ${measured}`;
}

export function readRecords(dir: string): RunRecord[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => RunRecord.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

import { describe, expect, it } from "vitest";

import { planMatrix } from "../src/matrix.js";
import { buildAggregate, median, reduction, summaryText } from "../src/report.js";
import { Aggregate, type RunRecord } from "../src/schema.js";
import { sampleRecord } from "./helpers.js";

/** A full 20-run matrix with fixed control/treatment costs and token totals. */
function fullMatrix(opts: { controlUsd: number; treatmentUsd: number; controlTokens: number; treatmentTokens: number; treatmentPasses?: boolean; noMatchPaid?: boolean }): RunRecord[] {
  return planMatrix("lemma-bench-v1").map((p) => {
    const treatment = p.arm === "treatment";
    const r = sampleRecord({
      arm: p.arm,
      runId: p.runId,
      taskId: p.taskId,
      match: p.match,
      repetition: p.repetition,
      matrixIndex: p.matrixIndex,
      totalTokens: treatment ? opts.treatmentTokens : opts.controlTokens,
      costUsd: treatment ? opts.treatmentUsd : opts.controlUsd,
      passed: treatment ? (opts.treatmentPasses ?? true) : true,
    });
    if (treatment && p.match === "no-match" && opts.noMatchPaid) {
      r.lemma = { ...r.lemma!, purchased: true, priceAtomic: "120000" };
    }
    return r;
  });
}

describe("report math", () => {
  it("computes medians for odd, even and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("computes reductions as 1 - treatment / control", () => {
    expect(reduction(1, 0.7)).toBe(0.3);
    expect(reduction(1, 1.2)).toBe(-0.2);
    expect(reduction(null, 1)).toBeNull();
    expect(reduction(0, 1)).toBeNull();
  });

  it("validates only when every pre-registered criterion is met", () => {
    const agg = buildAggregate(fullMatrix({ controlUsd: 1, treatmentUsd: 0.6, controlTokens: 1_000_000, treatmentTokens: 500_000 }), "lemma-bench-v1");
    expect(Aggregate.parse(agg)).toBeTruthy();
    expect(agg.complete).toBe(true);
    expect(agg.recordedRuns).toBe(20);
    expect(agg.matched.control.runs).toBe(9);
    expect(agg.matched.treatment.medianAllInUsd).toBe(0.6);
    expect(agg.reductions.allInCost).toBe(0.4);
    expect(agg.reductions.totalTokens).toBe(0.5);
    expect(agg.verdict).toBe("validated");
    expect(agg.summary).toMatch(/^Validated against the pre-registered 25% target/);
  });

  it("reports a missed target honestly and claims no savings", () => {
    const agg = buildAggregate(fullMatrix({ controlUsd: 1, treatmentUsd: 0.9, controlTokens: 1_000_000, treatmentTokens: 950_000 }), "lemma-bench-v1");
    expect(agg.reductions.allInCost).toBe(0.1);
    expect(agg.criteria.costTargetMet).toBe(false);
    expect(agg.verdict).toBe("not-validated");
    expect(agg.summary).toContain("Not validated");
    expect(agg.summary).toContain("the 25% all-in cost reduction target");
    expect(agg.summary).toContain("Savings are not claimed");
    expect(agg.summary).toContain("10.0% lower");
  });

  it("flags correctness regressions and no-match spend even when savings are large", () => {
    const regressed = buildAggregate(fullMatrix({ controlUsd: 1, treatmentUsd: 0.2, controlTokens: 1_000_000, treatmentTokens: 200_000, treatmentPasses: false }), "lemma-bench-v1");
    expect(regressed.criteria.noCorrectnessRegression).toBe(false);
    expect(regressed.verdict).toBe("not-validated");
    expect(regressed.summary).toContain("no correctness regression");
    const paid = buildAggregate(fullMatrix({ controlUsd: 1, treatmentUsd: 0.2, controlTokens: 1_000_000, treatmentTokens: 200_000, noMatchPaid: true }), "lemma-bench-v1");
    expect(paid.noMatch.treatmentUsdcSpentAtomic).toBe("120000");
    expect(paid.criteria.noMatchZeroSpend).toBe(false);
    expect(paid.verdict).toBe("not-validated");
  });

  it("marks a partial matrix incomplete and ignores exploratory records", () => {
    const records = fullMatrix({ controlUsd: 1, treatmentUsd: 0.5, controlTokens: 1_000_000, treatmentTokens: 500_000 }).slice(0, 6);
    records.push(sampleRecord({ series: "exploratory", runId: "smoke-20261002-x-control" }));
    const agg = buildAggregate(records, "lemma-bench-v1");
    expect(agg.recordedRuns).toBe(6);
    expect(agg.verdict).toBe("incomplete");
    expect(agg.summary).toMatch(/^Incomplete: 6 of 20 planned runs recorded. No savings claim/);
  });

  it("publishes no prompts, paths or environment fields", () => {
    const agg = buildAggregate(fullMatrix({ controlUsd: 1, treatmentUsd: 0.6, controlTokens: 1_000_000, treatmentTokens: 500_000 }), "lemma-bench-v1");
    const text = JSON.stringify(agg);
    expect(text).not.toMatch(/\/tmp\/|\/home\/|finalMessage|outputTail|promptSha256|OPENAI|PRIVATE_KEY/);
  });
});

describe("summaryText wording", () => {
  it("says higher, not negative lower, when treatment costs more", () => {
    const text = summaryText(
      "not-validated",
      { allInCost: -2.883, totalTokens: 0.749 } as Aggregate["reductions"],
      { control: { passRate: 0.889 }, treatment: { passRate: 1 } } as Aggregate["matched"],
      { costTargetMet: false, tokenTargetMet: true } as Aggregate["criteria"],
      20,
      20,
    );
    expect(text).toContain("all-in cost 288.3% higher");
    expect(text).toContain("total tokens 74.9% lower");
    expect(text).not.toMatch(/-\d/);
  });
});

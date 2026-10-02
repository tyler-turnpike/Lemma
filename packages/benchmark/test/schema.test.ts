import { describe, expect, it } from "vitest";

import { estimateCost, tokensFromUsage } from "../src/cost.js";
import { RunRecord } from "../src/schema.js";
import { sampleRecord } from "./helpers.js";

describe("run record schema", () => {
  it("accepts a complete control and treatment record", () => {
    expect(RunRecord.parse(sampleRecord())).toBeTruthy();
    const t = sampleRecord({ arm: "treatment" });
    t.lemma = { previewDecision: "reuse", purchased: true, priceAtomic: "120000", paymentHash: `0x${"ab".repeat(32)}`, warrantyStatus: "activated", warrantyTxHash: `0x${"cd".repeat(32)}`, gasUsed: null, appliedByBridge: true };
    expect(RunRecord.parse(t).lemma?.purchased).toBe(true);
  });

  it("rejects unknown arms, extra fields, human interventions and malformed hashes", () => {
    expect(RunRecord.safeParse({ ...sampleRecord(), arm: "lemma" }).success).toBe(false);
    expect(RunRecord.safeParse({ ...sampleRecord(), prompt: "full prompt text" }).success).toBe(false);
    expect(RunRecord.safeParse({ ...sampleRecord(), interventions: { count: 1, mode: "automated" } }).success).toBe(false);
    const t = sampleRecord({ arm: "treatment" });
    t.lemma = { ...t.lemma!, paymentHash: "0x1234" };
    expect(RunRecord.safeParse(t).success).toBe(false);
  });

  it("distinguishes startup and run failures", () => {
    expect(RunRecord.parse(sampleRecord({ error: { phase: "startup", message: "spawn failed" } })).error?.phase).toBe("startup");
    expect(RunRecord.safeParse(sampleRecord({ error: { phase: "crash" as never, message: "x" } })).success).toBe(false);
  });

  it("labels cost as an estimate and prices cached input separately", () => {
    const tokens = tokensFromUsage({ input_tokens: 1_000_000, cached_input_tokens: 900_000, cache_write_input_tokens: 0, output_tokens: 10_000, reasoning_output_tokens: 2_000 });
    expect(tokens.total).toBe(1_010_000);
    const cost = estimateCost("gpt-5.6-terra", tokens, 120_000n);
    // 100k uncached x $2 + 900k cached x $0.20 + 10k output x $12, per 1M tokens
    expect(cost.rawModelUsd).toBeCloseTo(0.2 + 0.18 + 0.12, 6);
    expect(cost.lemmaPriceUsd).toBe(0.12);
    expect(cost.allInUsd).toBeCloseTo(0.62, 6);
    expect(cost.label).toBe("estimate");
    expect(() => estimateCost("unknown-model", tokens)).toThrow(/no frozen price/);
  });

  it("records unreported usage as zero with reported=false", () => {
    expect(tokensFromUsage(null)).toMatchObject({ total: 0, reasoning: null, reported: false });
  });
});

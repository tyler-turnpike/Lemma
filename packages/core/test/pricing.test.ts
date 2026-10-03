import { describe, expect, it } from "vitest";

import { PRICE_TABLE } from "../../benchmark/src/config.js";
import { Preview } from "../src/schemas.js";
import { isPriceJustified } from "../src/policy.js";
import { MODEL_INPUT_USD_PER_MILLION, QUOTE_CAP_ATOMIC, QUOTE_GRID_ATOMIC, knownModel, quoteFor } from "../src/pricing.js";

const server = { floorAtomic: 5000n, expectedSavingAtomic: 23063n, basisModel: "gpt-5.6-luna" };

describe("quotes", () => {
  it("prices unknown or missing models as the benchmark model", () => {
    for (const model of ["gpt-5.6-luna", undefined, null, "some-model", ""]) {
      const q = quoteFor({ ...server, model });
      // ceil(25% of 23063) = 5766, up to the 500 grid = 6000: 0.005 up front, 0.001 on success.
      expect(q).toMatchObject({ model: "gpt-5.6-luna", floorAtomic: 5000n, successFeeAtomic: 1000n, totalAtomic: 6000n });
    }
  });

  it("charges only the floor when 25% of the saving is below it", () => {
    expect(quoteFor({ ...server, expectedSavingAtomic: 18000n })).toMatchObject({ successFeeAtomic: 0n, totalAtomic: 5000n });
  });

  it("scales with the buyer's model and captures 25% of the scaled saving", () => {
    const terra = quoteFor({ ...server, model: "gpt-5.6-terra" })!;
    expect(terra.expectedSavingAtomic).toBe(230630n);
    expect(terra.totalAtomic).toBe(58000n); // ceil(57657.5) to the 500 grid
    expect(terra.successFeeAtomic).toBe(53000n);
    const gpt55 = quoteFor({ ...server, model: "GPT-5.5" })!;
    expect(gpt55.model).toBe("gpt-5.5");
    expect(gpt55.totalAtomic).toBe(144500n);
  });

  it("never exceeds the cap or the 30% pricing rule, and stays on the grid", () => {
    for (const saving of [1n, 999n, 20000n, 23063n, 18682n, 40001n, 5_000_000n]) {
      for (const model of Object.keys(MODEL_INPUT_USD_PER_MILLION)) {
        const q = quoteFor({ floorAtomic: 5000n, expectedSavingAtomic: saving, basisModel: "gpt-5.6-luna", model })!;
        expect(q.totalAtomic).toBeLessThanOrEqual(QUOTE_CAP_ATOMIC);
        expect(q.totalAtomic).toBeGreaterThanOrEqual(q.floorAtomic);
        if (q.successFeeAtomic > 0n) {
          expect(isPriceJustified(q.totalAtomic, q.expectedSavingAtomic)).toBe(true);
          expect(q.totalAtomic % QUOTE_GRID_ATOMIC).toBe(0n);
        }
      }
    }
  });

  it("returns null without a measured saving or a known basis model", () => {
    expect(quoteFor({ ...server, expectedSavingAtomic: null })).toBeNull();
    expect(quoteFor({ ...server, basisModel: null })).toBeNull();
    expect(knownModel("toString")).toBeNull();
  });

  it("matches the benchmark's frozen price table", () => {
    for (const [model, usd] of Object.entries(MODEL_INPUT_USD_PER_MILLION)) {
      expect(PRICE_TABLE.usdPerMillion[model as keyof typeof PRICE_TABLE.usdPerMillion].input, model).toBe(usd);
    }
  });
});

describe("preview quote schema", () => {
  const base = {
    schemaVersion: "1",
    previewId: `0x${"11".repeat(32)}`,
    task: { schemaVersion: "1", kind: "x402-paywall-mcp-server", network: "arbitrum-sepolia" },
    profileDigest: `0x${"22".repeat(32)}`,
    decision: "reuse",
    releaseId: `0x${"33".repeat(32)}`,
    release: "x402-mcp-server@1.1.0",
    reasons: [],
    evidence: null,
    priceAtomic: "5000",
    expectedSavingAtomic: "23063",
    limitations: [],
    warranty: null,
    purchasable: true,
    provisionalOverride: false,
    issuedAt: "2026-10-03T10:00:00Z",
  };
  const quote = { model: "gpt-5.6-terra", basisModel: "gpt-5.6-luna", expectedSavingAtomic: "230630", floorAtomic: "5000", successFeeAtomic: "53000", totalAtomic: "58000", captureBps: 2500 };

  it("accepts previews with and without a quote", () => {
    expect(Preview.safeParse(base).success).toBe(true);
    expect(Preview.safeParse({ ...base, quote: null }).success).toBe(true);
    expect(Preview.safeParse({ ...base, quote }).success).toBe(true);
  });

  it("rejects a quote whose floor or total is inconsistent", () => {
    expect(Preview.safeParse({ ...base, quote: { ...quote, floorAtomic: "4000", successFeeAtomic: "54000" } }).success).toBe(false);
    expect(Preview.safeParse({ ...base, quote: { ...quote, totalAtomic: "60000" } }).success).toBe(false);
  });
});

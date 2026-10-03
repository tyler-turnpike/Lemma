// Browser copy of the quote rule in @lemma/core (packages/core/src/pricing.ts), kept dependency-free
// for the landing page. test/pricing.test.ts asserts it matches core for every model.

export const QUOTE_MODELS = [
  { id: "gpt-5.6-luna", label: "gpt-5.6-luna", inputUsd: 0.2 },
  { id: "gpt-5.4", label: "gpt-5.4", inputUsd: 2.5 },
  { id: "gpt-5.6-terra", label: "gpt-5.6-terra", inputUsd: 2.0 },
  { id: "gpt-5.6-sol", label: "gpt-5.6-sol", inputUsd: 4.0 },
  { id: "gpt-5.5", label: "gpt-5.5", inputUsd: 5.0 },
] as const;

export type QuoteModel = (typeof QUOTE_MODELS)[number]["id"];

/** The featured release: x402-mcp-server@1.1.0, measured on gpt-5.6-luna (lemma-bench-v1). */
export const FEATURED_QUOTE_BASIS = { floorAtomic: 5000n, expectedSavingAtomic: 23063n, basis: "gpt-5.6-luna" as QuoteModel };

const CAPTURE_BPS = 2500n;
const GRID = 500n;
const CAP = 250_000n;
const scaled = (id: QuoteModel) => BigInt(Math.round(QUOTE_MODELS.find((m) => m.id === id)!.inputUsd * 10_000));
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export function browserQuote(model: QuoteModel, basis = FEATURED_QUOTE_BASIS) {
  const saving = (basis.expectedSavingAtomic * scaled(model)) / scaled(basis.basis);
  const captured = ceilDiv(ceilDiv(saving * CAPTURE_BPS, 10_000n), GRID) * GRID;
  let total = captured < basis.floorAtomic ? basis.floorAtomic : captured;
  if (total > CAP) total = CAP < basis.floorAtomic ? basis.floorAtomic : CAP;
  if (total > basis.floorAtomic && total * 100n > saving * 30n) total = basis.floorAtomic;
  return { expectedSavingAtomic: saving, floorAtomic: basis.floorAtomic, successFeeAtomic: total - basis.floorAtomic, totalAtomic: total };
}

// Per-request quotes. A release's measured saving was taken on one model (the benchmark model); a
// buyer on a pricier model saves proportionally more, because a token reduction is a token reduction
// on any model. The quote captures a fixed share of that expected saving, never less than the
// registered (warranty-covered) price and never more than a cap.
//
// Settlement splits the quote in two: the floor is paid up front and is exactly the price the
// warranty registry bonds and refunds; the rest is a success fee paid only after the acceptance
// tests pass. Nothing paid before success is ever outside the warranty.

import { PRICE_TO_SAVING_MAX_PERCENT } from "./constants.js";
import { isPriceJustified } from "./policy.js";

/**
 * Standard-tier input list prices, USD per 1M tokens, from https://developers.openai.com/api/docs/pricing
 * (read 2026-10-02; the same table the benchmark froze). Within this table cached-input and output
 * prices scale by the same ratio as input, so the input price alone sets the saving ratio.
 */
export const MODEL_INPUT_USD_PER_MILLION: Readonly<Record<string, number>> = {
  "gpt-5.6-luna": 0.2,
  "gpt-5.6-terra": 2.0,
  "gpt-5.6-sol": 4.0,
  "gpt-5.4": 2.5,
  "gpt-5.5": 5.0,
};

/** Model each frozen benchmark measured on (packages/benchmark/src/config.ts FROZEN_AGENT.model). */
export const BENCHMARK_MODELS: Readonly<Record<string, string>> = {
  "lemma-bench-v1": "gpt-5.6-luna",
  "lemma-bench-v3": "gpt-5.6-luna",
};

/** Share of the expected saving charged, in basis points. Below the 30% pricing rule by design. */
export const QUOTE_CAPTURE_BPS = 2500n;
/** Quotes round up to this many atomic units (0.0005 USDC), which bounds distinct payment amounts. */
export const QUOTE_GRID_ATOMIC = 500n;
/** Upper bound on any quote (0.25 USDC), matching the bridge's default per-resolution cap. */
export const QUOTE_CAP_ATOMIC = 250_000n;

export type Quote = {
  /** Model the price was scaled to (the buyer's declaration, or the basis model when unknown). */
  model: string;
  /** Model the release's saving was measured on. */
  basisModel: string;
  /** Measured saving scaled to `model`. */
  expectedSavingAtomic: bigint;
  /** Paid up front; equals the registered price and is fully covered by the warranty. */
  floorAtomic: bigint;
  /** Paid only after the acceptance tests pass. */
  successFeeAtomic: bigint;
  totalAtomic: bigint;
  captureBps: bigint;
};

/** Known model id, normalised; null for anything not in the table. */
export function knownModel(model: unknown): string | null {
  if (typeof model !== "string") return null;
  const id = model.trim().toLowerCase();
  return Object.hasOwn(MODEL_INPUT_USD_PER_MILLION, id) ? id : null;
}

/** Integer ratio of two model prices as (num, den), exact for prices with up to 4 decimals. */
function priceRatio(model: string, basis: string): [bigint, bigint] {
  const scale = (usd: number) => BigInt(Math.round(usd * 10_000));
  return [scale(MODEL_INPUT_USD_PER_MILLION[model]!), scale(MODEL_INPUT_USD_PER_MILLION[basis]!)];
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * Quote for one buyer. Returns null when the release has no measured saving or the basis model is
 * unknown (nothing to scale from). An unknown or missing buyer model is priced as the basis model.
 */
export function quoteFor(input: { floorAtomic: bigint; expectedSavingAtomic: bigint | null; basisModel: string | null; model?: string | null }): Quote | null {
  const basis = knownModel(input.basisModel);
  if (input.expectedSavingAtomic === null || input.expectedSavingAtomic <= 0n || basis === null || input.floorAtomic <= 0n) return null;
  const model = knownModel(input.model) ?? basis;
  const [num, den] = priceRatio(model, basis);
  const saving = (input.expectedSavingAtomic * num) / den;
  const captured = ceilDiv(ceilDiv(saving * QUOTE_CAPTURE_BPS, 10_000n), QUOTE_GRID_ATOMIC) * QUOTE_GRID_ATOMIC;
  let total = captured < input.floorAtomic ? input.floorAtomic : captured;
  if (total > QUOTE_CAP_ATOMIC) total = QUOTE_CAP_ATOMIC < input.floorAtomic ? input.floorAtomic : QUOTE_CAP_ATOMIC;
  // Grid rounding must never push a quote over the pricing rule; fall back to the floor if it would.
  if (total > input.floorAtomic && !isPriceJustified(total, saving)) total = input.floorAtomic;
  return {
    model,
    basisModel: basis,
    expectedSavingAtomic: saving,
    floorAtomic: input.floorAtomic,
    successFeeAtomic: total - input.floorAtomic,
    totalAtomic: total,
    captureBps: QUOTE_CAPTURE_BPS,
  };
}

/** Pricing-rule ceiling for a saving, for display. */
export function maxJustifiedPrice(expectedSavingAtomic: bigint): bigint {
  return (expectedSavingAtomic * PRICE_TO_SAVING_MAX_PERCENT) / 100n;
}

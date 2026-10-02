import { PRICE_TABLE, type PricedModel } from "./config.js";
import type { CostEstimate, TokenUsage } from "./schema.js";

/** Converts Codex `Usage` (possibly null) into the record's token block. */
export function tokensFromUsage(
  usage: { input_tokens: number; cached_input_tokens: number; cache_write_input_tokens?: number; output_tokens: number; reasoning_output_tokens: number } | null,
): TokenUsage {
  if (usage === null) return { input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoning: null, total: 0, reported: false };
  return {
    input: usage.input_tokens,
    cachedInput: usage.cached_input_tokens,
    cacheWriteInput: usage.cache_write_input_tokens ?? 0,
    output: usage.output_tokens,
    reasoning: usage.reasoning_output_tokens,
    total: usage.input_tokens + usage.output_tokens,
    reported: true,
  };
}

/** Sums usage across turns (a run normally has one turn). */
export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  if (!a.reported) return b;
  if (!b.reported) return a;
  return {
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    cacheWriteInput: a.cacheWriteInput + b.cacheWriteInput,
    output: a.output + b.output,
    reasoning: a.reasoning === null && b.reasoning === null ? null : (a.reasoning ?? 0) + (b.reasoning ?? 0),
    total: a.total + b.total,
    reported: true,
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Raw model cost estimate from the frozen price table. Throws for an unpriced model (fail closed). */
export function estimateCost(model: string, tokens: TokenUsage, lemmaPriceAtomic: bigint = 0n): CostEstimate {
  const rates = (PRICE_TABLE.usdPerMillion as Record<string, (typeof PRICE_TABLE.usdPerMillion)[PricedModel]>)[model];
  if (rates === undefined) throw new Error(`no frozen price for model ${model}; add it to PRICE_TABLE before running`);
  const cached = Math.min(tokens.cachedInput, tokens.input);
  const uncached = tokens.input - cached;
  const raw = (uncached * rates.input + cached * rates.cachedInput + tokens.output * rates.output) / 1_000_000;
  const lemma = Number(lemmaPriceAtomic) / 1_000_000;
  return {
    label: "estimate",
    currency: "USD",
    model,
    priceSource: PRICE_TABLE.source,
    ratesUsdPerMillion: { input: rates.input, cachedInput: rates.cachedInput, output: rates.output },
    rawModelUsd: round6(raw),
    lemmaPriceUsd: round6(lemma),
    allInUsd: round6(raw + lemma),
  };
}

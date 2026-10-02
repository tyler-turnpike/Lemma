/**
 * Frozen experiment configuration. Changing anything in this file after the final
 * matrix has started requires a new EXPERIMENT_VERSION (see docs/benchmark-protocol.md).
 */

export const EXPERIMENT_VERSION = "lemma-bench-v1";

/** Records from the smoke run and any other non-final run go here and are never aggregated. */
export const EXPLORATORY_DIR = "exploratory";

export const REPETITIONS = 3;

/**
 * Model and agent parameters, frozen for both arms.
 *
 * Model selection (2026-10-02): `GET /v1/models` with the benchmark key listed gpt-5.4, gpt-5.5,
 * gpt-5.6-{sol,terra,luna} and others. Codex CLI 0.160.0 ships model metadata for gpt-5.5 and the
 * gpt-5.6 family but not for dated snapshots (it warns "Model metadata ... not found" and degrades),
 * so a dated snapshot cannot be used without degrading the agent. gpt-5.6-luna is the lowest-priced
 * gpt-5.6 model with first-class Codex metadata, chosen to fit the available API budget (a terra
 * smoke run cost about $0.38; luna list prices are one tenth of terra's). It is an alias, not a dated snapshot: the report
 * discloses that provider-side model updates during the experiment window are not controlled.
 */
export const FROZEN_AGENT = {
  provider: "openai",
  runtime: "@openai/codex-sdk@0.160.0 (codex-cli 0.160.0)",
  model: "gpt-5.6-luna",
  modelReasoningEffort: "medium",
  /** Shell commands get no network in either arm; dependencies are pre-resolved from the repo. */
  shellNetworkAccess: false,
  /** Same "open-source research" channel for both arms: OpenAI's cached web index, no live fetches. */
  webSearchMode: "cached",
  approvalPolicy: "never",
  /** Codex permission profile equivalent to workspace-write plus read denials (see sandbox.ts). */
  sandbox: "workspace-write (permission profile: root read, workspace + tmp write, harness/repo denied)",
  /** Wall-clock budget per run, including agent startup. Acceptance runs after and is not counted. */
  timeBudgetMs: 20 * 60 * 1000,
} as const;

export type FrozenAgent = typeof FROZEN_AGENT;

/**
 * Frozen per-model list prices in USD per 1M tokens, standard tier, copied from
 * https://developers.openai.com/api/docs/pricing on 2026-10-02. Cost figures derived from these are
 * ESTIMATES: the OpenAI API does not return a charged cost per Codex turn, prices may change, and
 * long-context or priority tiers are ignored. Token counts are kept as the independent measure.
 *
 * Billing convention used: `input_tokens` includes `cached_input_tokens`; cached tokens are billed at
 * the cached rate, the remainder at the input rate. `output_tokens` includes reasoning tokens.
 * `cache_write_input_tokens` are part of `input_tokens` and carry no separate surcharge.
 */
export const PRICE_TABLE = {
  source: "https://developers.openai.com/api/docs/pricing (standard tier, read 2026-10-02)",
  label: "estimate",
  usdPerMillion: {
    "gpt-5.6-terra": { input: 2.0, cachedInput: 0.2, output: 12.0 },
    "gpt-5.6-sol": { input: 4.0, cachedInput: 0.4, output: 20.0 },
    "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
    "gpt-5.5": { input: 5.0, cachedInput: 0.5, output: 30.0 },
    "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15.0 },
    "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  },
} as const;

export type PricedModel = keyof typeof PRICE_TABLE.usdPerMillion;

/** Bridge spend limits for treatment runs (decimal USDC, passed to lemma-mcp as non-secret env). */
export const BRIDGE_LIMITS = {
  maxUsdcPerResolution: "0.25",
  /** 9 matched treatment runs x 0.12 USDC = 1.08 USDC; the cap leaves room without being unbounded. */
  dailyUsdcCap: "1.50",
} as const;

/** Success thresholds from docs/benchmark-protocol.md. */
export const SUCCESS_CRITERIA = {
  minCostReduction: 0.25,
  minTokenReduction: 0.25,
} as const;

export const LEMMA_SCHEMA_VERSION = "1" as const;

export const LEMMA_DECISIONS = ["reuse", "adapt", "build", "decline"] as const;
export type LemmaDecision = (typeof LEMMA_DECISIONS)[number];

export const TASK_KINDS = [
  "x402-paywall-mcp-server",
  "x402-paying-mcp-client",
  "x402-facilitator-hono",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const NETWORKS = ["arbitrum-sepolia"] as const;
export type LemmaNetwork = (typeof NETWORKS)[number];

export const ARBITRUM_SEPOLIA = {
  network: "arbitrum-sepolia",
  chainId: 421614,
  caip2: "eip155:421614",
  usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  usdcDecimals: 6,
} as const;

export const EVIDENCE_STATUSES = ["provisional", "benchmarked"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const ADOPTION_OUTCOMES = ["passed", "failed", "abandoned"] as const;
export type AdoptionOutcome = (typeof ADOPTION_OUTCOMES)[number];

/** Contract enum: 0 = None (never signed), 1 = Passed, 2 = Failed. */
export const OUTCOME_RESULT = { Passed: 1, Failed: 2 } as const;
export type OutcomeResult = (typeof OUTCOME_RESULT)[keyof typeof OUTCOME_RESULT];

/** 72 hours. */
export const DEFAULT_CLAIM_WINDOW_SECONDS = 259_200;

/** Pricing rule: price may be at most 30% of measured expected saving. */
export const PRICE_TO_SAVING_MAX_PERCENT = 30n;

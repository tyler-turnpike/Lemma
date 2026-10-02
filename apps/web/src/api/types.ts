// Read models for the public /api/v1 endpoints (shapes match apps/server/src/app.ts).
// Every response is untrusted: parsers keep only the fields the dashboard renders and
// reject anything that does not have the expected shape. Patch bundles are never modelled.

export type Hex = string;

export interface ReleaseSummary {
  readonly id: string;
  readonly releaseId: Hex;
  readonly name: string;
  readonly version: string;
  readonly title: string;
  readonly summary: string;
  readonly taskKind: string;
  readonly network: string;
  readonly supportedProfile: {
    readonly languages: readonly string[];
    readonly moduleSystems: readonly string[];
    readonly packageManagers: readonly string[];
    readonly testRunners: readonly string[];
    readonly exact: Readonly<Record<string, string>>;
    readonly boundary: Readonly<Record<string, string>>;
  };
  readonly provenance: {
    readonly upstreamRepo: string;
    readonly commit: string;
    readonly spdxLicense: string;
    readonly attribution: string;
    readonly modifications: string;
  };
  readonly payloadDigest: Hex;
  readonly fileCount: number;
  readonly priceAtomic: string;
  readonly bondAtomic: string;
  readonly claimWindowSeconds: number;
  readonly expiresAt: string;
  readonly evidence: {
    readonly status: "provisional" | "benchmarked";
    readonly benchmarkVersion: string | null;
    readonly expectedSavingAtomic: string | null;
    readonly expectedTokenSaving: number | null;
  };
  readonly limitations: readonly string[];
}

export interface ReleasesResponse {
  readonly releases: readonly ReleaseSummary[];
}

export interface ResolutionSummary {
  readonly resolutionId: Hex;
  readonly release: string;
  readonly releaseId: Hex;
  readonly buyer: Hex;
  readonly priceAtomic: string;
  readonly status: "pending" | "settled";
  readonly paymentHash: Hex | null;
  readonly payloadDigest: Hex | null;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly payment: {
    readonly txHash: Hex;
    readonly network: string;
    readonly payer: Hex;
    readonly amountAtomic: string;
    readonly settledAt: string;
  } | null;
  readonly voucher: {
    readonly chainId: number;
    readonly verifyingContract: Hex;
    readonly signer: Hex;
    readonly signature: Hex;
    readonly voucher: {
      readonly resolutionId: Hex;
      readonly releaseId: Hex;
      readonly buyer: Hex;
      readonly amount: string;
      readonly paymentHash: Hex;
      readonly payloadDigest: Hex;
      readonly expiresAt: string;
    };
  } | null;
  readonly receipts: {
    readonly count: number;
    readonly latestOutcome: AdoptionOutcome | null;
    readonly latestAt: string | null;
  };
}

export type AdoptionOutcome = "passed" | "failed" | "abandoned";

export interface AdoptionReceiptSummary {
  readonly receiptId: Hex;
  readonly outcome: AdoptionOutcome;
  readonly buyer: Hex;
  readonly testSummary: {
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly durationMs: number;
    readonly exitCode: number | null;
  };
  readonly filesChanged: number;
  readonly evidenceDigest: Hex;
  readonly signedAt: string;
  readonly receivedAt: string;
}

export interface AdoptionReceiptsResponse {
  readonly resolutionId: Hex;
  readonly receipts: readonly AdoptionReceiptSummary[];
}

export interface StatusResponse {
  readonly version: string;
  readonly chain: { readonly network: string; readonly chainId: number; readonly caip2: string };
  readonly usdc: Hex;
  readonly registry: Hex | null;
  readonly provider: Hex | null;
  readonly facilitator: Hex | null;
  readonly evaluator: Hex | null;
  readonly paidTools: { readonly enabled: boolean; readonly reason: string | null };
  readonly provisionalOverride: boolean;
  readonly trust: { readonly evaluator: string; readonly network: string; readonly notice: string };
}

export interface BenchmarkArm {
  readonly runs: number | null;
  readonly passed: number | null;
  readonly medianCostUsd: number | null;
  readonly medianTotalTokens: number | null;
  readonly passRate: number | null;
  readonly medianDurationMs: number | null;
}

export interface BenchmarkAggregate {
  readonly benchmarkVersion: string | null;
  readonly network: string | null;
  readonly generatedAt: string | null;
  /** Recorded runs in the final series. */
  readonly runs: number | null;
  readonly plannedRuns: number | null;
  readonly complete: boolean | null;
  readonly model: string | null;
  readonly costLabel: string | null;
  readonly summary: string | null;
  readonly verdict: "validated" | "not-validated" | "incomplete" | null;
  readonly control: BenchmarkArm;
  readonly treatment: BenchmarkArm;
  /** Fractional reductions (0.31 = 31% lower), treatment vs control medians. */
  readonly costReduction: number | null;
  readonly tokenReduction: number | null;
  readonly noMatchSpendAtomic: string | null;
  readonly noMatchRuns: number | null;
  readonly criteria: {
    readonly costTargetMet: boolean | null;
    readonly tokenTargetMet: boolean | null;
    readonly noCorrectnessRegression: boolean | null;
  };
  readonly limitations: readonly string[];
}

export type BenchmarksResponse =
  | { readonly status: "not-run" }
  | { readonly status: "published"; readonly aggregate: BenchmarkAggregate | null };

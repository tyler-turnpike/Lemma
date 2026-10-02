// Hand-rolled shape checks for untrusted API JSON (no runtime schema dependency in the bundle).
// A parser throws ParseError when a required field is missing or has the wrong type.

import type {
  AdoptionOutcome,
  AdoptionReceiptSummary,
  AdoptionReceiptsResponse,
  BenchmarkAggregate,
  BenchmarkArm,
  BenchmarksResponse,
  ReleaseSummary,
  ReleasesResponse,
  ResolutionSummary,
  StatusResponse,
} from "./types.js";

export class ParseError extends Error {
  override name = "ParseError";
}

type Obj = Record<string, unknown>;

const MAX_TEXT = 4000;

function obj(value: unknown, at: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ParseError(`${at}: expected object`);
  return value as Obj;
}

function str(value: unknown, at: string): string {
  if (typeof value !== "string" || value.length > MAX_TEXT) throw new ParseError(`${at}: expected string`);
  return value;
}

function strOrNull(value: unknown, at: string): string | null {
  return value === null || value === undefined ? null : str(value, at);
}

function num(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ParseError(`${at}: expected number`);
  return value;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") throw new ParseError(`${at}: expected boolean`);
  return value;
}

function strList(value: unknown, at: string): string[] {
  if (!Array.isArray(value) || value.length > 256) throw new ParseError(`${at}: expected array`);
  return value.map((item, i) => str(item, `${at}[${i}]`));
}

function strRecord(value: unknown, at: string): Record<string, string> {
  const o = obj(value, at);
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(o).slice(0, 64)) out[key] = str(v, `${at}.${key}`);
  return out;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], at: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new ParseError(`${at}: unexpected value`);
  return value as T;
}

const OUTCOMES = ["passed", "failed", "abandoned"] as const satisfies readonly AdoptionOutcome[];

export function parseRelease(value: unknown, at = "release"): ReleaseSummary {
  const r = obj(value, at);
  const profile = obj(r.supportedProfile, `${at}.supportedProfile`);
  const provenance = obj(r.provenance, `${at}.provenance`);
  const evidence = obj(r.evidence, `${at}.evidence`);
  return {
    id: str(r.id, `${at}.id`),
    releaseId: str(r.releaseId, `${at}.releaseId`),
    name: str(r.name, `${at}.name`),
    version: str(r.version, `${at}.version`),
    title: str(r.title, `${at}.title`),
    summary: str(r.summary, `${at}.summary`),
    taskKind: str(r.taskKind, `${at}.taskKind`),
    network: str(r.network, `${at}.network`),
    supportedProfile: {
      languages: strList(profile.languages, `${at}.languages`),
      moduleSystems: strList(profile.moduleSystems, `${at}.moduleSystems`),
      packageManagers: strList(profile.packageManagers, `${at}.packageManagers`),
      testRunners: strList(profile.testRunners, `${at}.testRunners`),
      exact: strRecord(profile.exact ?? {}, `${at}.exact`),
      boundary: strRecord(profile.boundary ?? {}, `${at}.boundary`),
    },
    provenance: {
      upstreamRepo: str(provenance.upstreamRepo, `${at}.upstreamRepo`),
      commit: str(provenance.commit, `${at}.commit`),
      spdxLicense: str(provenance.spdxLicense, `${at}.spdxLicense`),
      attribution: str(provenance.attribution, `${at}.attribution`),
      modifications: str(provenance.modifications, `${at}.modifications`),
    },
    payloadDigest: str(r.payloadDigest, `${at}.payloadDigest`),
    fileCount: num(r.fileCount, `${at}.fileCount`),
    priceAtomic: str(r.priceAtomic, `${at}.priceAtomic`),
    bondAtomic: str(r.bondAtomic, `${at}.bondAtomic`),
    claimWindowSeconds: num(r.claimWindowSeconds, `${at}.claimWindowSeconds`),
    expiresAt: str(r.expiresAt, `${at}.expiresAt`),
    evidence: {
      status: oneOf(evidence.status, ["provisional", "benchmarked"] as const, `${at}.evidence.status`),
      benchmarkVersion: strOrNull(evidence.benchmarkVersion, `${at}.evidence.benchmarkVersion`),
      expectedSavingAtomic: strOrNull(evidence.expectedSavingAtomic, `${at}.evidence.expectedSavingAtomic`),
      expectedTokenSaving: numOrNull(evidence.expectedTokenSaving),
    },
    limitations: strList(r.limitations ?? [], `${at}.limitations`),
  };
}

export function parseReleases(value: unknown): ReleasesResponse {
  const body = obj(value, "releases");
  if (!Array.isArray(body.releases) || body.releases.length > 500) throw new ParseError("releases: expected array");
  return { releases: body.releases.map((r, i) => parseRelease(r, `releases[${i}]`)) };
}

export function parseResolution(value: unknown): ResolutionSummary {
  const r = obj(value, "resolution");
  const payment = r.payment === null || r.payment === undefined ? null : obj(r.payment, "payment");
  const voucher = r.voucher === null || r.voucher === undefined ? null : obj(r.voucher, "voucher");
  const message = voucher === null ? null : obj(voucher.voucher, "voucher.voucher");
  const receipts = obj(r.receipts, "receipts");
  return {
    resolutionId: str(r.resolutionId, "resolutionId"),
    release: str(r.release, "release"),
    releaseId: str(r.releaseId, "releaseId"),
    buyer: str(r.buyer, "buyer"),
    priceAtomic: str(r.priceAtomic, "priceAtomic"),
    status: oneOf(r.status, ["pending", "settled"] as const, "status"),
    paymentHash: strOrNull(r.paymentHash, "paymentHash"),
    payloadDigest: strOrNull(r.payloadDigest, "payloadDigest"),
    issuedAt: strOrNull(r.issuedAt, "issuedAt"),
    expiresAt: strOrNull(r.expiresAt, "expiresAt"),
    payment:
      payment === null
        ? null
        : {
            txHash: str(payment.txHash, "payment.txHash"),
            network: str(payment.network, "payment.network"),
            payer: str(payment.payer, "payment.payer"),
            amountAtomic: str(payment.amountAtomic, "payment.amountAtomic"),
            settledAt: str(payment.settledAt, "payment.settledAt"),
          },
    voucher:
      voucher === null || message === null
        ? null
        : {
            chainId: num(voucher.chainId, "voucher.chainId"),
            verifyingContract: str(voucher.verifyingContract, "voucher.verifyingContract"),
            signer: str(voucher.signer, "voucher.signer"),
            signature: str(voucher.signature, "voucher.signature"),
            voucher: {
              resolutionId: str(message.resolutionId, "voucher.resolutionId"),
              releaseId: str(message.releaseId, "voucher.releaseId"),
              buyer: str(message.buyer, "voucher.buyer"),
              amount: str(message.amount, "voucher.amount"),
              paymentHash: str(message.paymentHash, "voucher.paymentHash"),
              payloadDigest: str(message.payloadDigest, "voucher.payloadDigest"),
              expiresAt: str(message.expiresAt, "voucher.expiresAt"),
            },
          },
    receipts: {
      count: num(receipts.count, "receipts.count"),
      latestOutcome: receipts.latestOutcome === null || receipts.latestOutcome === undefined ? null : oneOf(receipts.latestOutcome, OUTCOMES, "receipts.latestOutcome"),
      latestAt: strOrNull(receipts.latestAt, "receipts.latestAt"),
    },
  };
}

function parseReceipt(value: unknown, at: string): AdoptionReceiptSummary {
  const r = obj(value, at);
  const t = obj(r.testSummary, `${at}.testSummary`);
  return {
    receiptId: str(r.receiptId, `${at}.receiptId`),
    outcome: oneOf(r.outcome, OUTCOMES, `${at}.outcome`),
    buyer: str(r.buyer, `${at}.buyer`),
    testSummary: {
      passed: num(t.passed, `${at}.passed`),
      failed: num(t.failed, `${at}.failed`),
      skipped: num(t.skipped, `${at}.skipped`),
      durationMs: num(t.durationMs, `${at}.durationMs`),
      exitCode: numOrNull(t.exitCode),
    },
    filesChanged: num(r.filesChanged, `${at}.filesChanged`),
    evidenceDigest: str(r.evidenceDigest, `${at}.evidenceDigest`),
    signedAt: str(r.signedAt, `${at}.signedAt`),
    receivedAt: str(r.receivedAt, `${at}.receivedAt`),
  };
}

export function parseReceipts(value: unknown): AdoptionReceiptsResponse {
  const body = obj(value, "receipts");
  if (!Array.isArray(body.receipts) || body.receipts.length > 500) throw new ParseError("receipts: expected array");
  return { resolutionId: str(body.resolutionId, "resolutionId"), receipts: body.receipts.map((r, i) => parseReceipt(r, `receipts[${i}]`)) };
}

export function parseStatus(value: unknown): StatusResponse {
  const s = obj(value, "status");
  const chain = obj(s.chain, "chain");
  const paid = obj(s.paidTools, "paidTools");
  const trust = obj(s.trust, "trust");
  return {
    version: str(s.version, "version"),
    chain: { network: str(chain.network, "chain.network"), chainId: num(chain.chainId, "chain.chainId"), caip2: str(chain.caip2, "chain.caip2") },
    usdc: str(s.usdc, "usdc"),
    registry: strOrNull(s.registry, "registry"),
    provider: strOrNull(s.provider, "provider"),
    facilitator: strOrNull(s.facilitator, "facilitator"),
    evaluator: strOrNull(s.evaluator, "evaluator"),
    paidTools: { enabled: bool(paid.enabled, "paidTools.enabled"), reason: strOrNull(paid.reason, "paidTools.reason") },
    provisionalOverride: bool(s.provisionalOverride, "provisionalOverride"),
    trust: { evaluator: str(trust.evaluator, "trust.evaluator"), network: str(trust.network, "trust.network"), notice: str(trust.notice, "trust.notice") },
  };
}

// ---- benchmark aggregate -----------------------------------------------------------
// The aggregate format is owned by packages/benchmark (Aggregate in src/schema.ts: matched.{control,
// treatment}, reductions.{allInCost,totalTokens}, noMatch.treatmentUsdcSpentAtomic, criteria, verdict).
// This reader also tolerates a few aliases; anything it cannot place is left null rather than guessed.

function pick(o: Obj, keys: readonly string[]): unknown {
  for (const key of keys) if (o[key] !== undefined) return o[key];
  return undefined;
}

function rate(value: unknown): number | null {
  const n = numOrNull(value);
  if (n === null || n < 0) return null;
  return n > 1 ? (n <= 100 ? n / 100 : null) : n;
}

/** Signed fraction for reductions; percentages (|n| > 1) are scaled down. Negative = treatment cost more. */
function signedRate(value: unknown): number | null {
  const n = numOrNull(value);
  if (n === null || Math.abs(n) > 100) return null;
  return Math.abs(n) > 1 ? n / 100 : n;
}

function parseArm(value: unknown): BenchmarkArm {
  const a = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : {};
  return {
    runs: numOrNull(pick(a, ["runs", "n"])),
    passed: numOrNull(a.passed),
    medianCostUsd: numOrNull(pick(a, ["medianAllInUsd", "medianCostUsd", "medianAllInCostUsd", "medianCost"])),
    medianTotalTokens: numOrNull(pick(a, ["medianTotalTokens", "medianTokens"])),
    passRate: rate(pick(a, ["passRate", "acceptancePassRate"])),
    medianDurationMs: numOrNull(pick(a, ["medianDurationMs", "medianWallClockMs"])),
  };
}

function reduction(control: number | null, treatment: number | null): number | null {
  return control === null || treatment === null || control <= 0 ? null : (control - treatment) / control;
}

export function parseBenchmarkAggregate(value: unknown): BenchmarkAggregate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const a = value as Obj;
  const armsRaw = pick(a, ["matched", "arms"]);
  const arms = typeof armsRaw === "object" && armsRaw !== null ? (armsRaw as Obj) : a;
  const controlRaw = pick(arms, ["control"]);
  const treatmentRaw = pick(arms, ["treatment", "lemma"]);
  if (controlRaw === undefined || treatmentRaw === undefined) return null;
  const control = parseArm(controlRaw);
  const treatment = parseArm(treatmentRaw);
  const redRaw = pick(a, ["reductions", "reduction"]);
  const red = typeof redRaw === "object" && redRaw !== null ? (redRaw as Obj) : {};
  const crit = typeof a.criteria === "object" && a.criteria !== null ? (a.criteria as Obj) : {};
  const flag = (v: unknown) => (typeof v === "boolean" ? v : null);
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const noMatch = typeof a.noMatch === "object" && a.noMatch !== null ? (a.noMatch as Obj) : {};
  const spend = pick(noMatch, ["treatmentUsdcSpentAtomic", "treatmentSpendAtomic", "spendAtomic"]);
  const noMatchTreatment = typeof noMatch.treatment === "object" && noMatch.treatment !== null ? (noMatch.treatment as Obj) : {};
  const limitations = Array.isArray(a.limitations) ? a.limitations.filter((l): l is string => typeof l === "string" && l.length <= 500).slice(0, 32) : [];
  return {
    benchmarkVersion: text(pick(a, ["experimentVersion", "benchmarkVersion"]), 64),
    network: text(a.network, 64),
    generatedAt: text(a.generatedAt, 64),
    runs: numOrNull(pick(a, ["recordedRuns", "runs", "n", "totalRuns"])),
    plannedRuns: numOrNull(a.plannedRuns),
    complete: flag(a.complete),
    model: text(a.model, 120),
    costLabel: text(a.costLabel, 500),
    summary: text(a.summary, 2000),
    verdict: a.verdict === "validated" || a.verdict === "not-validated" || a.verdict === "incomplete" ? a.verdict : null,
    control,
    treatment,
    costReduction: signedRate(pick(red, ["allInCost", "cost", "costPercent", "costReduction"])) ?? reduction(control.medianCostUsd, treatment.medianCostUsd),
    tokenReduction: signedRate(pick(red, ["totalTokens", "tokens", "tokensPercent", "tokenReduction"])) ?? reduction(control.medianTotalTokens, treatment.medianTotalTokens),
    noMatchSpendAtomic: typeof spend === "string" && /^(0|[1-9][0-9]{0,30})$/.test(spend) ? spend : null,
    noMatchRuns: numOrNull(pick(noMatchTreatment, ["runs"])) ?? numOrNull(pick(noMatch, ["runs", "n"])),
    criteria: { costTargetMet: flag(crit.costTargetMet), tokenTargetMet: flag(crit.tokenTargetMet), noCorrectnessRegression: flag(crit.noCorrectnessRegression) },
    limitations,
  };
}

export function parseBenchmarks(value: unknown): BenchmarksResponse {
  const b = obj(value, "benchmarks");
  if (b.status === "not-run") return { status: "not-run" };
  if (b.status === "published") return { status: "published", aggregate: parseBenchmarkAggregate(b.aggregate) };
  throw new ParseError("benchmarks: unexpected status");
}

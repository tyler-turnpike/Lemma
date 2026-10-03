import {
  CapabilityRelease,
  Preview,
  RepositoryProfile,
  TaskRequest,
  compareVersions,
  digest,
  BENCHMARK_MODELS,
  isPriceJustified,
  quoteFor,
  releaseIdFor,
  satisfiesRange,
  type CapabilityRelease as CapabilityReleaseT,
  type LemmaDecision,
  type Preview as PreviewT,
  type ProfileDependency,
  type RepositoryProfile as RepositoryProfileT,
  type TaskRequest as TaskRequestT,
} from "@lemma/core";

export type ReleaseSource = readonly CapabilityReleaseT[] | { listReleases(): readonly CapabilityReleaseT[] };

export type ResolveOptions = {
  /**
   * Testnet demo only. Allows a reuse/adapt offer backed by provisional (unbenchmarked)
   * evidence to be purchasable. Never overrides a benchmarked price that fails the pricing rule.
   */
  allowProvisional?: boolean;
  /** Buyer-declared model (self-reported), used only to scale the quote. */
  model?: string | null;
};

export class ResolverInputError extends Error {
  override name = "ResolverInputError";
}

type Tier = "exact" | "boundary" | "soft-miss" | "hard-miss";
type Fit = { release: CapabilityReleaseT; tier: Tier; reasons: string[] };

const TIER_RANK: Record<Tier, number> = { exact: 0, boundary: 1, "soft-miss": 2, "hard-miss": 3 };
const NODE_LANGUAGES = new Set(["typescript", "javascript"]);

export const WARRANTY_COVERAGE =
  "If the pinned acceptance recipe fails on the declared profile within the claim window and the evaluator confirms the failure, the buyer may withdraw a refund equal to the price from the provider bond.";

/**
 * Pure, deterministic compatibility resolution. Hard-filters the catalog by task kind,
 * network, language, frameworks, dependency constraints and expiry, then returns a free
 * Preview. Only reuse/adapt decisions carry a price; purchasability also requires the
 * pricing rule (price <= 30% of measured saving) unless `allowProvisional` is set.
 * Throws ResolverInputError on invalid task or profile (fail closed).
 */
export function resolve(task: TaskRequestT, profile: RepositoryProfileT, catalog: ReleaseSource, now: Date, options: ResolveOptions = {}): PreviewT {
  const parsedTask = TaskRequest.safeParse(task);
  if (!parsedTask.success) throw new ResolverInputError("invalid task request");
  const parsedProfile = RepositoryProfile.safeParse(profile);
  if (!parsedProfile.success) throw new ResolverInputError("invalid repository profile");
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new ResolverInputError("invalid clock");
  const t = parsedTask.data;
  const p = parsedProfile.data;

  const releases = (Array.isArray(catalog) ? catalog : (catalog as { listReleases(): readonly CapabilityReleaseT[] }).listReleases()).map((r) =>
    CapabilityRelease.parse(r),
  );
  const candidates = releases.filter((r) => r.taskKind === t.kind && r.network === t.network);
  const issuedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const profileDigest = digest(p);

  const base = { schemaVersion: "1" as const, task: t, profileDigest, issuedAt };
  const free = (decision: Extract<LemmaDecision, "build" | "decline">, reasons: string[]): PreviewT =>
    finalize({
      ...base,
      decision,
      releaseId: null,
      release: null,
      reasons,
      evidence: null,
      priceAtomic: null,
      expectedSavingAtomic: null,
      limitations: [],
      warranty: null,
      purchasable: false,
      provisionalOverride: false,
      quote: null,
    });

  if (candidates.length === 0) {
    return NODE_LANGUAGES.has(p.language)
      ? free("build", [`no curated release exists for task ${t.kind}; build it directly`])
      : free("decline", [`no curated release exists for task ${t.kind}`, `language ${p.language} is not supported`]);
  }

  const fits = candidates.map((r) => assessFit(r, p, now)).sort(compareFits);
  const best = fits[0] as Fit;

  if (best.tier === "hard-miss") {
    return free("decline", ["repository profile is outside every supported profile for this task", ...prefixReasons(fits)]);
  }
  if (best.tier === "soft-miss") {
    return free("build", ["no compatible release for this profile; building directly is recommended", ...prefixReasons(fits)]);
  }

  const r = best.release;
  const price = BigInt(r.priceAtomic);
  const saving = r.evidence.expectedSavingAtomic === null ? null : BigInt(r.evidence.expectedSavingAtomic);
  const justified = isPriceJustified(price, saving);
  const provisionalOverride = !justified && options.allowProvisional === true && r.evidence.status === "provisional";
  const purchasable = justified || provisionalOverride;
  const decision: LemmaDecision = best.tier === "exact" ? "reuse" : "adapt";

  const reasons = [
    decision === "reuse" ? `profile matches the exact supported profile of ${r.id}` : `profile is within the boundary constraints of ${r.id}`,
    ...best.reasons,
  ];
  if (justified) reasons.push("price is at most 30% of the measured expected saving");
  else if (saving === null) reasons.push("no frozen benchmark supports this release; previewable but not sellable under the pricing rule");
  else reasons.push("price exceeds 30% of the measured expected saving");
  if (provisionalOverride) reasons.push("testnet demo override: provisional evidence allowed for purchase");

  // Per-request quote: the registered price is the floor (paid up front, warranty-covered); a success
  // fee up to 25% of the saving scaled to the buyer's model is paid only after acceptance passes.
  const q =
    justified && saving !== null
      ? quoteFor({ floorAtomic: price, expectedSavingAtomic: saving, basisModel: BENCHMARK_MODELS[r.evidence.benchmarkVersion ?? ""] ?? null, model: options.model ?? null })
      : null;
  const quote =
    q === null
      ? null
      : {
          model: q.model,
          basisModel: q.basisModel,
          expectedSavingAtomic: q.expectedSavingAtomic.toString(),
          floorAtomic: q.floorAtomic.toString(),
          successFeeAtomic: q.successFeeAtomic.toString(),
          totalAtomic: q.totalAtomic.toString(),
          captureBps: Number(q.captureBps),
        };
  if (q !== null) {
    reasons.push(
      q.successFeeAtomic > 0n
        ? `quoted for ${q.model}: ${q.floorAtomic} atomic USDC up front, ${q.successFeeAtomic} more only if the acceptance tests pass`
        : `quoted for ${q.model}: ${q.floorAtomic} atomic USDC, no success fee`,
    );
  }

  return finalize({
    ...base,
    decision,
    releaseId: releaseIdFor(r.id),
    release: r.id,
    reasons,
    evidence: r.evidence,
    priceAtomic: r.priceAtomic,
    expectedSavingAtomic: r.evidence.expectedSavingAtomic,
    limitations: r.limitations,
    warranty: { bondAtomic: r.bondAtomic, claimWindowSeconds: r.claimWindowSeconds, coverage: WARRANTY_COVERAGE },
    purchasable,
    provisionalOverride,
    quote,
  });
}

function finalize(preview: Omit<PreviewT, "previewId">): PreviewT {
  const previewId = digest({
    task: preview.task,
    profileDigest: preview.profileDigest,
    decision: preview.decision,
    release: preview.release,
    purchasable: preview.purchasable,
    issuedAt: preview.issuedAt,
  });
  return Preview.parse({ ...preview, previewId });
}

/** Classifies how a release fits a profile. Exported for diagnostics and tests. */
export function assessFit(release: CapabilityReleaseT, profile: RepositoryProfileT, now: Date): Fit {
  const sp = release.supportedProfile;
  const hard: string[] = [];
  const soft: string[] = [];

  if (!sp.languages.includes(profile.language)) hard.push(`language ${profile.language} is not supported`);
  for (const f of sp.requiredFrameworks) if (!profile.frameworks[f]) hard.push(`requires ${f}`);
  for (const f of sp.forbiddenFrameworks) if (profile.frameworks[f]) hard.push(`already uses ${f}`);
  if (hard.length > 0) return { release, tier: "hard-miss", reasons: hard };

  if (Date.parse(release.expiresAt) <= now.getTime()) soft.push(`release expired at ${release.expiresAt}`);
  if (!sp.moduleSystems.includes(profile.moduleSystem)) soft.push(`module system ${profile.moduleSystem} is not supported`);
  if (!sp.packageManagers.includes(profile.packageManager)) soft.push(`package manager ${profile.packageManager} is not supported`);
  if (!sp.testRunners.includes(profile.testRunner)) soft.push(`test runner ${profile.testRunner} is not supported`);
  if (sp.requireLockfile && !profile.lockfile.present) soft.push("a lockfile is required");
  for (const [name, range] of Object.entries(sp.boundary) as Array<[ProfileDependency, string]>) {
    const version = profile.dependencies[name];
    if (version === undefined) soft.push(`${name} is missing or not pinned to an exact version`);
    else if (!satisfiesRange(version, range)) soft.push(`${name}@${version} is outside ${range}`);
  }
  if (soft.length > 0) return { release, tier: "soft-miss", reasons: soft };

  const drift = (Object.entries(sp.exact) as Array<[ProfileDependency, string]>)
    .filter(([name, version]) => profile.dependencies[name] !== version)
    .map(([name, version]) => `${name}@${profile.dependencies[name] ?? "missing"} differs from benchmarked ${version}`);
  return drift.length === 0 ? { release, tier: "exact", reasons: [] } : { release, tier: "boundary", reasons: drift };
}

function compareFits(a: Fit, b: Fit): number {
  const tier = TIER_RANK[a.tier] - TIER_RANK[b.tier];
  if (tier !== 0) return tier;
  const version = compareVersions(b.release.version, a.release.version);
  if (version !== 0) return version;
  return a.release.id < b.release.id ? -1 : a.release.id > b.release.id ? 1 : 0;
}

function prefixReasons(fits: Fit[]): string[] {
  return fits.flatMap((f) => f.reasons.map((reason) => `${f.release.id}: ${reason}`));
}

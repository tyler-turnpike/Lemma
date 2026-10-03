import { z } from "zod";

import {
  ADOPTION_OUTCOMES,
  DEFAULT_CLAIM_WINDOW_SECONDS,
  EVIDENCE_STATUSES,
  LEMMA_DECISIONS,
  LEMMA_SCHEMA_VERSION,
  NETWORKS,
  TASK_KINDS,
} from "./constants.js";
import { validateBundlePath } from "./paths.js";
import { EXACT_VERSION_RE, isValidRange } from "./semver.js";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const SchemaVersion = z.literal(LEMMA_SCHEMA_VERSION);

/** 0x-prefixed lowercase 32-byte hex (keccak digests, identifiers). */
export const Bytes32 = z.string().regex(/^0x[0-9a-f]{64}$/, "expected 0x-prefixed lowercase 32-byte hex");
export type Bytes32 = `0x${string}`;

/** Bare lowercase sha256 hex (file content digests). */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "expected lowercase sha256 hex without 0x");

export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected 20-byte hex address");

export const HexSignature = z.string().regex(/^0x[0-9a-fA-F]{130}$/, "expected 65-byte hex signature");

/** Non-negative integer in atomic units, as a decimal string (no leading zeros). */
export const AtomicAmount = z.string().regex(/^(0|[1-9][0-9]{0,30})$/, "expected atomic integer string");

/** uint64 as decimal string. */
export const Uint64String = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/)
  .refine((v) => /^[0-9]{1,20}$/.test(v) && BigInt(v) <= 0xffffffffffffffffn, "exceeds uint64");

export const IsoDateTime = z.iso.datetime({ offset: false });

export const ExactVersion = z.string().max(64).regex(EXACT_VERSION_RE, "expected exact semver");
export const VersionRange = z.string().max(128).refine(isValidRange, "expected comparator range like \">=1.0.0 <2.0.0\"");

const ShortText = z.string().min(1).max(280);
const LongText = z.string().min(1).max(2000);

// ---------------------------------------------------------------------------
// Repository profile (allowlisted metadata only; never paths or source)
// ---------------------------------------------------------------------------

/** Reviewed dependency names that may appear in a profile. Anything else is dropped. */
export const PROFILE_DEPENDENCY_ALLOWLIST = [
  "@modelcontextprotocol/sdk",
  "@x402/core",
  "@x402/evm",
  "@x402/mcp",
  "@x402/fetch",
  "@x402/hono",
  "@x402/express",
  "@hono/node-server",
  "hono",
  "express",
  "viem",
  "zod",
  "typescript",
  "vitest",
  "jest",
  "tsx",
] as const;
export type ProfileDependency = (typeof PROFILE_DEPENDENCY_ALLOWLIST)[number];

export const LANGUAGES = ["typescript", "javascript", "python", "go", "rust", "other"] as const;
export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun", "pip", "poetry", "uv", "cargo", "go", "unknown"] as const;
export const LOCKFILE_KINDS = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "other"] as const;
export const MODULE_SYSTEMS = ["esm", "commonjs", "unknown"] as const;
export const TEST_RUNNERS = ["vitest", "jest", "node-test", "mocha", "none", "unknown"] as const;
export const FRAMEWORK_FLAGS = ["mcpSdk", "hono", "express", "x402"] as const;
export type FrameworkFlag = (typeof FRAMEWORK_FLAGS)[number];

export const RepositoryProfile = z.strictObject({
  schemaVersion: SchemaVersion,
  language: z.enum(LANGUAGES),
  packageManager: z.enum(PACKAGE_MANAGERS),
  nodeEngine: z
    .string()
    .max(64)
    .regex(/^[0-9xX*.^~<>=| -]+$/)
    .nullable(),
  lockfile: z.strictObject({
    present: z.boolean(),
    kind: z.enum(LOCKFILE_KINDS).nullable(),
    digest: Bytes32.nullable(),
  }),
  dependencies: z.partialRecord(z.enum(PROFILE_DEPENDENCY_ALLOWLIST), ExactVersion),
  moduleSystem: z.enum(MODULE_SYSTEMS),
  frameworks: z.strictObject({
    mcpSdk: z.boolean(),
    hono: z.boolean(),
    express: z.boolean(),
    x402: z.boolean(),
  }),
  testRunner: z.enum(TEST_RUNNERS),
});
export type RepositoryProfile = z.infer<typeof RepositoryProfile>;

// ---------------------------------------------------------------------------
// Task request
// ---------------------------------------------------------------------------

export const TaskKindSchema = z.enum(TASK_KINDS);
export const NetworkSchema = z.enum(NETWORKS);

export const TaskRequest = z.strictObject({
  schemaVersion: SchemaVersion,
  kind: TaskKindSchema,
  network: NetworkSchema,
});
export type TaskRequest = z.infer<typeof TaskRequest>;

// ---------------------------------------------------------------------------
// Acceptance recipe (argv arrays only; no shell strings)
// ---------------------------------------------------------------------------

/** Executables a recipe may invoke. Spawned without a shell. */
export const ACCEPTANCE_EXECUTABLES = ["npx", "npm", "node", "pnpm", "yarn"] as const;
const SECRET_ENV_NAME_RE = /(KEY|SECRET|TOKEN|PASSWORD|PRIVATE|MNEMONIC|DATABASE_URL|CREDENTIAL)/i;

const ArgvToken = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => !/[\0\n\r]/.test(s), "argv tokens may not contain NUL or newlines");

export const AcceptanceRecipe = z.strictObject({
  argv: z
    .array(
      z
        .array(ArgvToken)
        .min(1)
        .max(32)
        .refine((argv) => (ACCEPTANCE_EXECUTABLES as readonly string[]).includes(argv[0] ?? ""), {
          message: `argv[0] must be one of ${ACCEPTANCE_EXECUTABLES.join(", ")}`,
        })
        .refine((argv) => argv[0] !== "npx" || argv[1] === "--no", {
          message: "npx steps must pass --no to forbid remote package downloads",
        }),
    )
    .min(1)
    .max(8),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  env: z
    .array(z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/))
    .max(32)
    .refine((names) => names.every((n) => !SECRET_ENV_NAME_RE.test(n)), "secret-bearing env names are not allowed"),
});
export type AcceptanceRecipe = z.infer<typeof AcceptanceRecipe>;

// ---------------------------------------------------------------------------
// Patch bundle
// ---------------------------------------------------------------------------

export const BundlePath = z.string().superRefine((value, ctx) => {
  const problem = validateBundlePath(value);
  if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
});

const ContentBase64 = z
  .string()
  .max(2_000_000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, "expected base64");

export const PatchFileOp = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("create"),
    path: BundlePath,
    baseSha256: z.null(),
    contentBase64: ContentBase64,
    newSha256: Sha256Hex,
  }),
  z.strictObject({
    op: z.literal("modify"),
    path: BundlePath,
    baseSha256: Sha256Hex,
    contentBase64: ContentBase64,
    newSha256: Sha256Hex,
  }),
]);
export type PatchFileOp = z.infer<typeof PatchFileOp>;

const DependencyName = z.string().regex(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/).max(214);

/** Structured package.json additions (applied as a JSON merge, not a byte patch). */
export const DependencyAdditions = z.strictObject({
  dependencies: z.record(DependencyName, ExactVersion),
  devDependencies: z.record(DependencyName, ExactVersion),
});
export type DependencyAdditions = z.infer<typeof DependencyAdditions>;

export const PatchBundle = z
  .strictObject({
    schemaVersion: SchemaVersion,
    release: z.string().max(140),
    operations: z.array(PatchFileOp).min(1).max(64),
    dependencyAdditions: DependencyAdditions,
  })
  .superRefine((bundle, ctx) => {
    const seen = new Set<string>();
    for (const op of bundle.operations) {
      const key = op.path.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: "custom", message: `duplicate path ${op.path}` });
      seen.add(key);
    }
  });
export type PatchBundle = z.infer<typeof PatchBundle>;

// ---------------------------------------------------------------------------
// Capability Release manifest
// ---------------------------------------------------------------------------

export const SupportedProfile = z.strictObject({
  languages: z.array(z.enum(LANGUAGES)).min(1),
  moduleSystems: z.array(z.enum(MODULE_SYSTEMS)).min(1),
  packageManagers: z.array(z.enum(PACKAGE_MANAGERS)).min(1),
  testRunners: z.array(z.enum(TEST_RUNNERS)).min(1),
  requireLockfile: z.boolean(),
  requiredFrameworks: z.array(z.enum(FRAMEWORK_FLAGS)),
  forbiddenFrameworks: z.array(z.enum(FRAMEWORK_FLAGS)),
  /** Exact, benchmarked profile. All must match for a "reuse" decision. */
  exact: z.partialRecord(z.enum(PROFILE_DEPENDENCY_ALLOWLIST), ExactVersion),
  /** Boundary constraints. All must be satisfied for an "adapt" decision. */
  boundary: z.partialRecord(z.enum(PROFILE_DEPENDENCY_ALLOWLIST), VersionRange),
});
export type SupportedProfile = z.infer<typeof SupportedProfile>;

export const Provenance = z.strictObject({
  upstreamRepo: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, "expected https GitHub repo URL"),
  /** Full 40-hex commit SHA. Branches, tags and short SHAs are mutable or ambiguous. */
  commit: z.string().regex(/^[0-9a-f]{40}$/, "expected immutable 40-hex commit SHA"),
  spdxLicense: z.string().regex(/^[A-Za-z0-9.+-]{2,64}$/),
  attribution: LongText,
  modifications: LongText,
});
export type Provenance = z.infer<typeof Provenance>;

export const ReleaseEvidence = z
  .strictObject({
    status: z.enum(EVIDENCE_STATUSES),
    benchmarkVersion: z.string().min(1).max(64).nullable(),
    expectedSavingAtomic: AtomicAmount.nullable(),
    expectedTokenSaving: z.number().int().nonnegative().nullable(),
  })
  .superRefine((e, ctx) => {
    if (e.status === "benchmarked" && (e.benchmarkVersion === null || e.expectedSavingAtomic === null)) {
      ctx.addIssue({ code: "custom", message: "benchmarked evidence requires benchmarkVersion and expectedSavingAtomic" });
    }
    if (e.status === "provisional" && (e.benchmarkVersion !== null || e.expectedSavingAtomic !== null || e.expectedTokenSaving !== null)) {
      ctx.addIssue({ code: "custom", message: "provisional evidence must not carry measured values" });
    }
  });
export type ReleaseEvidence = z.infer<typeof ReleaseEvidence>;

export const ManifestPatchOp = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("create"), path: BundlePath }),
  z.strictObject({ op: z.literal("modify"), path: BundlePath, baseSha256: Sha256Hex }),
]);
export type ManifestPatchOp = z.infer<typeof ManifestPatchOp>;

export const CapabilityRelease = z
  .strictObject({
    schemaVersion: SchemaVersion,
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}@[0-9]+\.[0-9]+\.[0-9]+$/),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    version: ExactVersion,
    title: ShortText,
    summary: LongText,
    taskKind: TaskKindSchema,
    network: NetworkSchema,
    supportedProfile: SupportedProfile,
    provenance: Provenance,
    patch: z.strictObject({
      operations: z.array(ManifestPatchOp).min(1).max(64),
      dependencyAdditions: DependencyAdditions,
    }),
    payloadDigest: Bytes32,
    acceptance: AcceptanceRecipe,
    priceAtomic: AtomicAmount,
    bondAtomic: AtomicAmount,
    claimWindowSeconds: z.number().int().min(3_600).max(2_592_000).default(DEFAULT_CLAIM_WINDOW_SECONDS),
    expiresAt: IsoDateTime,
    evidence: ReleaseEvidence,
    limitations: z.array(ShortText).max(32),
  })
  .superRefine((r, ctx) => {
    if (r.id !== `${r.name}@${r.version}`) ctx.addIssue({ code: "custom", message: "id must equal name@version" });
    const atomic = /^(0|[1-9][0-9]*)$/;
    if (atomic.test(r.bondAtomic) && atomic.test(r.priceAtomic) && BigInt(r.bondAtomic) < BigInt(r.priceAtomic)) {
      ctx.addIssue({ code: "custom", message: "bondAtomic must cover priceAtomic" });
    }
  });
export type CapabilityRelease = z.infer<typeof CapabilityRelease>;
export type CapabilityReleaseInput = z.input<typeof CapabilityRelease>;

// ---------------------------------------------------------------------------
// Preview (free decision)
// ---------------------------------------------------------------------------

export const WarrantyTerms = z.strictObject({
  bondAtomic: AtomicAmount,
  claimWindowSeconds: z.number().int().positive(),
  coverage: LongText,
});
export type WarrantyTerms = z.infer<typeof WarrantyTerms>;

/** Per-request quote (core/pricing.ts), as strings on the wire. */
export const PreviewQuote = z.strictObject({
  model: z.string().max(64),
  basisModel: z.string().max(64),
  expectedSavingAtomic: AtomicAmount,
  floorAtomic: AtomicAmount,
  successFeeAtomic: AtomicAmount,
  totalAtomic: AtomicAmount,
  captureBps: z.number().int().min(0).max(10_000),
});
export type PreviewQuote = z.infer<typeof PreviewQuote>;

export const Preview = z
  .strictObject({
    schemaVersion: SchemaVersion,
    previewId: Bytes32,
    task: TaskRequest,
    profileDigest: Bytes32,
    decision: z.enum(LEMMA_DECISIONS),
    releaseId: Bytes32.nullable(),
    release: z.string().max(140).nullable(),
    reasons: z.array(z.string().max(500)).max(64),
    evidence: ReleaseEvidence.nullable(),
    priceAtomic: AtomicAmount.nullable(),
    expectedSavingAtomic: AtomicAmount.nullable(),
    limitations: z.array(ShortText).max(32),
    warranty: WarrantyTerms.nullable(),
    purchasable: z.boolean(),
    provisionalOverride: z.boolean(),
    /** Absent on previews from servers without per-request quotes; then priceAtomic is the whole price. */
    quote: PreviewQuote.nullable().optional(),
    issuedAt: IsoDateTime,
  })
  .superRefine((p, ctx) => {
    const offer = p.decision === "reuse" || p.decision === "adapt";
    if (!offer && (p.priceAtomic !== null || p.purchasable || p.warranty !== null)) {
      ctx.addIssue({ code: "custom", message: "build/decline previews never carry a price, warranty or purchase offer" });
    }
    if (offer && (p.releaseId === null || p.priceAtomic === null)) {
      ctx.addIssue({ code: "custom", message: "reuse/adapt previews must name a release and price" });
    }
    if (p.quote != null) {
      const q = p.quote;
      if (p.priceAtomic !== q.floorAtomic) ctx.addIssue({ code: "custom", message: "quote floor must equal the preview price" });
      if (BigInt(q.floorAtomic) + BigInt(q.successFeeAtomic) !== BigInt(q.totalAtomic)) {
        ctx.addIssue({ code: "custom", message: "quote total must equal floor plus success fee" });
      }
    }
  });
export type Preview = z.infer<typeof Preview>;

// ---------------------------------------------------------------------------
// EIP-712 message shapes (must match LemmaWarrantyRegistry exactly)
// ---------------------------------------------------------------------------

export const ResolutionVoucherMessage = z.strictObject({
  resolutionId: Bytes32,
  releaseId: Bytes32,
  buyer: Address,
  amount: AtomicAmount,
  paymentHash: Bytes32,
  payloadDigest: Bytes32,
  expiresAt: Uint64String,
});
export type ResolutionVoucherMessage = z.infer<typeof ResolutionVoucherMessage>;

export const OutcomeMessage = z.strictObject({
  resolutionId: Bytes32,
  result: z.union([z.literal(1), z.literal(2)]),
  evidenceDigest: Bytes32,
});
export type OutcomeMessage = z.infer<typeof OutcomeMessage>;

const Eip712Envelope = {
  schemaVersion: SchemaVersion,
  chainId: z.number().int().positive(),
  verifyingContract: Address,
  signer: Address,
  signature: HexSignature,
};

export const SignedResolutionVoucher = z.strictObject({ ...Eip712Envelope, voucher: ResolutionVoucherMessage });
export type SignedResolutionVoucher = z.infer<typeof SignedResolutionVoucher>;

export const SignedOutcome = z.strictObject({ ...Eip712Envelope, outcome: OutcomeMessage });
export type SignedOutcome = z.infer<typeof SignedOutcome>;

// ---------------------------------------------------------------------------
// Compatibility resolution (paid object)
// ---------------------------------------------------------------------------

export const CompatibilityResolution = z.strictObject({
  schemaVersion: SchemaVersion,
  resolutionId: Bytes32,
  previewId: Bytes32,
  releaseId: Bytes32,
  release: z.string().max(140),
  buyer: Address,
  priceAtomic: AtomicAmount,
  paymentHash: Bytes32,
  payloadDigest: Bytes32,
  bundle: PatchBundle,
  acceptance: AcceptanceRecipe,
  issuedAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type CompatibilityResolution = z.infer<typeof CompatibilityResolution>;

// ---------------------------------------------------------------------------
// Adoption receipt
// ---------------------------------------------------------------------------

export const TestSummary = z.strictObject({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
});
export type TestSummary = z.infer<typeof TestSummary>;

export const AdoptionReceipt = z.strictObject({
  schemaVersion: SchemaVersion,
  resolutionId: Bytes32,
  outcome: z.enum(ADOPTION_OUTCOMES),
  testSummary: TestSummary,
  filesChanged: z.number().int().nonnegative().max(10_000),
  evidenceDigest: Bytes32,
  buyer: Address,
  signedAt: IsoDateTime,
});
export type AdoptionReceipt = z.infer<typeof AdoptionReceipt>;

export const SignedAdoptionReceipt = z.strictObject({
  schemaVersion: SchemaVersion,
  receipt: AdoptionReceipt,
  /** Buyer signature over `adoptionReceiptDigest(receipt)` (EIP-191 personal_sign of the 32 bytes). */
  signature: HexSignature,
});
export type SignedAdoptionReceipt = z.infer<typeof SignedAdoptionReceipt>;

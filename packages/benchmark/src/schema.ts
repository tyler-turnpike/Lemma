import { z } from "zod";

export const ARMS = ["control", "treatment"] as const;
export const Arm = z.enum(ARMS);
export type Arm = z.infer<typeof Arm>;

const NonNegInt = z.number().int().nonnegative();
const IsoTime = z.iso.datetime();
const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const TokenUsage = z.strictObject({
  input: NonNegInt,
  cachedInput: NonNegInt,
  /** Reported by Codex as cache_write_input_tokens; part of `input`. */
  cacheWriteInput: NonNegInt,
  output: NonNegInt,
  /** Reasoning output tokens when reported (part of `output`); null when the runtime did not report usage. */
  reasoning: NonNegInt.nullable(),
  /** input + output. */
  total: NonNegInt,
  /** False when no turn.completed usage was received (e.g. timeout or startup failure); counts are then 0. */
  reported: z.boolean(),
});
export type TokenUsage = z.infer<typeof TokenUsage>;

export const CostEstimate = z.strictObject({
  label: z.literal("estimate"),
  currency: z.literal("USD"),
  model: z.string(),
  priceSource: z.string(),
  ratesUsdPerMillion: z.strictObject({ input: z.number().nonnegative(), cachedInput: z.number().nonnegative(), output: z.number().nonnegative() }),
  /** Estimated raw model cost (list price x tokens). Never a charged amount. */
  rawModelUsd: z.number().nonnegative(),
  /** Lemma resolution price in USD (USDC at par), 0 when nothing was paid. */
  lemmaPriceUsd: z.number().nonnegative(),
  /** rawModelUsd + lemmaPriceUsd. Gas is reported separately and excluded (testnet ETH). */
  allInUsd: z.number().nonnegative(),
});
export type CostEstimate = z.infer<typeof CostEstimate>;

export const ToolCalls = z.strictObject({
  total: NonNegInt,
  commands: NonNegInt,
  failedCommands: NonNegInt,
  fileChanges: NonNegInt,
  mcp: NonNegInt,
  webSearches: NonNegInt,
  /** Each MCP call (server, tool, status), in order. No arguments or results are kept. */
  mcpCalls: z.array(z.strictObject({ server: z.string(), tool: z.string(), status: z.string() })),
});

export const FilesChanged = z.strictObject({
  added: z.array(z.string()),
  modified: z.array(z.string()),
  deleted: z.array(z.string()),
  count: NonNegInt,
});

export const AcceptanceOutcome = z.strictObject({
  ran: z.boolean(),
  passed: z.boolean(),
  testPath: z.string(),
  argv: z.array(z.array(z.string())),
  durationMs: NonNegInt,
  exitCodes: z.array(z.number().int().nullable()),
  timedOut: z.boolean(),
  /** True if the agent changed the acceptance test; the original bytes are restored before acceptance runs. */
  testTampered: z.boolean(),
  /** Redacted tail of runner output. */
  outputTail: z.string(),
});

export const LemmaPayment = z.strictObject({
  /** Decision reported by lemma_preview, when the agent called it. */
  previewDecision: z.string().nullable(),
  purchased: z.boolean(),
  priceAtomic: z.string().regex(/^\d+$/).nullable(),
  paymentHash: Hex32.nullable(),
  warrantyStatus: z.string().nullable(),
  warrantyTxHash: Hex32.nullable(),
  /** Gas used by warranty activation, when the bridge reports it. Null otherwise. */
  gasUsed: z.string().nullable(),
  appliedByBridge: z.boolean(),
});
export type LemmaPayment = z.infer<typeof LemmaPayment>;

export const RunError = z.strictObject({
  /** startup: the agent never started a thread (spawn, auth, config). run: it started and then failed. */
  phase: z.enum(["startup", "run", "timeout", "harness"]),
  message: z.string(),
});
export type RunError = z.infer<typeof RunError>;

export const RunRecord = z.strictObject({
  schemaVersion: z.literal("1"),
  experimentVersion: z.string(),
  /** "final" records count toward the report; "exploratory" (smoke, debugging) never do. */
  series: z.enum(["final", "exploratory"]),
  runId: z.string().regex(/^[a-z0-9-]{8,80}$/),
  arm: Arm,
  taskId: z.string(),
  match: z.enum(["matched", "no-match"]),
  repetition: z.number().int().min(1),
  matrixIndex: NonNegInt,
  agent: z.strictObject({
    provider: z.string(),
    runtime: z.string(),
    model: z.string(),
    modelReasoningEffort: z.string(),
    shellNetworkAccess: z.boolean(),
    webSearchMode: z.string(),
    approvalPolicy: z.string(),
    sandbox: z.string(),
    timeBudgetMs: NonNegInt,
  }),
  /** sha256 over the prompt text; the prompt itself is reproducible from the frozen source. */
  promptSha256: z.string().regex(/^[0-9a-f]{64}$/),
  fixture: z.strictObject({ id: z.string(), digest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }),
  threadId: z.string().nullable(),
  startedAt: IsoTime,
  endedAt: IsoTime,
  durationMs: NonNegInt,
  agentDurationMs: NonNegInt,
  tokens: TokenUsage,
  cost: CostEstimate,
  toolCalls: ToolCalls,
  filesChanged: FilesChanged,
  acceptance: AcceptanceOutcome,
  /** Human interventions. The harness is fully automated, so this is always 0 for recorded runs. */
  interventions: z.strictObject({ count: z.literal(0), mode: z.literal("automated") }),
  lemma: LemmaPayment.nullable(),
  error: RunError.nullable(),
  /** Redacted, truncated final agent message. */
  finalMessage: z.string(),
});
export type RunRecord = z.infer<typeof RunRecord>;

const ArmSummary = z.strictObject({
  runs: NonNegInt,
  passed: NonNegInt,
  passRate: z.number().min(0).max(1),
  medianAllInUsd: z.number().nullable(),
  medianRawModelUsd: z.number().nullable(),
  medianTotalTokens: z.number().nullable(),
  medianDurationMs: z.number().nullable(),
  lemmaSpendUsd: z.number(),
  startupFailures: NonNegInt,
  runFailures: NonNegInt,
});

/** Published aggregate (served by apps/server at GET /api/v1/benchmarks). Contains no prompts, paths, or env. */
export const Aggregate = z.strictObject({
  schemaVersion: z.literal("1"),
  experimentVersion: z.string(),
  generatedAt: IsoTime,
  model: z.string(),
  runtime: z.string(),
  costLabel: z.string(),
  plannedRuns: NonNegInt,
  recordedRuns: NonNegInt,
  complete: z.boolean(),
  matched: z.strictObject({ control: ArmSummary, treatment: ArmSummary }),
  noMatch: z.strictObject({ control: ArmSummary, treatment: ArmSummary, treatmentUsdcSpentAtomic: z.string() }),
  reductions: z.strictObject({
    /** 1 - treatment median / control median, over matched tasks. Null when either side has no data. */
    allInCost: z.number().nullable(),
    totalTokens: z.number().nullable(),
  }),
  perTask: z.array(
    z.strictObject({
      taskId: z.string(),
      match: z.enum(["matched", "no-match"]),
      control: ArmSummary,
      treatment: ArmSummary,
    }),
  ),
  criteria: z.strictObject({
    costTargetMet: z.boolean(),
    tokenTargetMet: z.boolean(),
    noCorrectnessRegression: z.boolean(),
    noMatchZeroSpend: z.boolean(),
    allMet: z.boolean(),
  }),
  verdict: z.enum(["validated", "not-validated", "incomplete"]),
  summary: z.string(),
  limitations: z.array(z.string()),
});
export type Aggregate = z.infer<typeof Aggregate>;

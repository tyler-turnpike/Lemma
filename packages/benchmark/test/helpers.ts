import { FROZEN_AGENT } from "../src/config.js";
import { estimateCost } from "../src/cost.js";
import type { Arm, RunRecord } from "../src/schema.js";

export function sampleRecord(over: Partial<RunRecord> & { arm?: Arm; totalTokens?: number; costUsd?: number; passed?: boolean } = {}): RunRecord {
  const { totalTokens = 100_000, costUsd, passed = true, ...rest } = over;
  const arm = over.arm ?? "control";
  const tokens = { input: totalTokens - 1000, cachedInput: 0, cacheWriteInput: 0, output: 1000, reasoning: 200, total: totalTokens, reported: true };
  const cost = estimateCost(FROZEN_AGENT.model, tokens);
  if (costUsd !== undefined) {
    cost.rawModelUsd = costUsd;
    cost.allInUsd = costUsd + cost.lemmaPriceUsd;
  }
  return {
    schemaVersion: "1",
    experimentVersion: "lemma-bench-v1",
    series: "final",
    runId: `lemma-bench-v1-mcp-server-paywall-exact-${arm}-r1`,
    arm,
    taskId: "mcp-server-paywall-exact",
    match: "matched",
    repetition: 1,
    matrixIndex: 0,
    agent: { ...FROZEN_AGENT },
    promptSha256: "a".repeat(64),
    fixture: { id: "mcp-server-exact", digest: `sha256:${"b".repeat(64)}` },
    threadId: "thread-1",
    startedAt: "2026-10-02T10:00:00.000Z",
    endedAt: "2026-10-02T10:05:00.000Z",
    durationMs: 300_000,
    agentDurationMs: 290_000,
    tokens,
    cost,
    toolCalls: { total: 3, commands: 2, failedCommands: 0, fileChanges: 1, mcp: 0, webSearches: 0, mcpCalls: [] },
    filesChanged: { added: ["src/lemma/x402-paywall.ts"], modified: ["src/server.ts"], deleted: [], count: 2 },
    acceptance: { ran: true, passed, testPath: "test/lemma-x402-paywall.test.ts", argv: [["npx", "--no", "vitest", "run", "test/lemma-x402-paywall.test.ts"]], durationMs: 900, exitCodes: [passed ? 0 : 1], timedOut: false, testTampered: false, outputTail: "Tests 4 passed" },
    interventions: { count: 0, mode: "automated" },
    lemma: arm === "treatment" ? { previewDecision: "reuse", purchased: false, priceAtomic: null, paymentHash: null, warrantyStatus: null, warrantyTxHash: null, gasUsed: null, appliedByBridge: false } : null,
    error: null,
    finalMessage: "done",
    ...rest,
  };
}

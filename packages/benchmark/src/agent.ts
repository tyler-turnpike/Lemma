import { Codex, type CodexOptions, type ThreadItem, type ThreadOptions } from "@openai/codex-sdk";

import { addTokens, tokensFromUsage } from "./cost.js";
import type { LemmaPayment, RunError, TokenUsage } from "./schema.js";

export type AgentResult = {
  threadId: string | null;
  items: ThreadItem[];
  finalMessage: string;
  tokens: TokenUsage;
  durationMs: number;
  error: RunError | null;
};

/**
 * Runs one fresh Codex thread on the prompt with a hard wall-clock budget.
 * A failure before `thread.started` is a startup failure; afterwards it is a run failure.
 */
export async function runAgent(options: CodexOptions, thread: ThreadOptions, prompt: string, budgetMs: number): Promise<AgentResult> {
  const started = Date.now();
  const items = new Map<string, ThreadItem>();
  let threadId: string | null = null;
  let tokens = tokensFromUsage(null);
  let error: RunError | null = null;
  let finalMessage = "";
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), budgetMs);
  try {
    const codex = new Codex(options);
    const t = codex.startThread(thread);
    const { events } = await t.runStreamed(prompt, { signal: abort.signal });
    for await (const event of events) {
      switch (event.type) {
        case "thread.started":
          threadId = event.thread_id;
          break;
        case "item.completed":
          items.set(event.item.id, event.item);
          if (event.item.type === "agent_message") finalMessage = event.item.text;
          break;
        case "item.started":
        case "item.updated":
          if (!items.has(event.item.id) || event.type === "item.updated") items.set(event.item.id, event.item);
          break;
        case "turn.completed":
          tokens = addTokens(tokens, tokensFromUsage(event.usage));
          break;
        case "turn.failed":
          error = { phase: "run", message: event.error.message };
          break;
        case "error":
          error = { phase: threadId === null ? "startup" : "run", message: event.message };
          break;
        default:
          break;
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (abort.signal.aborted) error = { phase: "timeout", message: `time budget of ${budgetMs} ms exceeded` };
    else error = { phase: threadId === null ? "startup" : "run", message };
  } finally {
    clearTimeout(timer);
  }
  return { threadId, items: [...items.values()], finalMessage, tokens, durationMs: Date.now() - started, error };
}

export function countToolCalls(items: readonly ThreadItem[]) {
  let commands = 0;
  let failedCommands = 0;
  let fileChanges = 0;
  let mcp = 0;
  let webSearches = 0;
  const mcpCalls: Array<{ server: string; tool: string; status: string }> = [];
  for (const item of items) {
    if (item.type === "command_execution") {
      commands += 1;
      if (item.status === "failed" || (item.exit_code !== undefined && item.exit_code !== 0)) failedCommands += 1;
    } else if (item.type === "file_change") fileChanges += 1;
    else if (item.type === "mcp_tool_call") {
      mcp += 1;
      mcpCalls.push({ server: item.server, tool: item.tool, status: item.status });
    } else if (item.type === "web_search") webSearches += 1;
  }
  return { total: commands + fileChanges + mcp + webSearches, commands, failedCommands, fileChanges, mcp, webSearches, mcpCalls };
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const asRecord = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null);
const asHex32 = (v: unknown): string | null => (typeof v === "string" && HEX32.test(v) ? v : null);

/** Extracts the x402 price, payment hash and warranty activation from the bridge's MCP results. */
export function extractLemmaPayment(items: readonly ThreadItem[]): LemmaPayment {
  const out: LemmaPayment = {
    previewDecision: null,
    purchased: false,
    priceAtomic: null,
    paymentHash: null,
    warrantyStatus: null,
    warrantyTxHash: null,
    gasUsed: null,
    appliedByBridge: false,
  };
  for (const item of items) {
    if (item.type !== "mcp_tool_call" || item.server !== "lemma" || item.status !== "completed") continue;
    const data = asRecord(item.result?.structured_content);
    if (data === null || data.error !== undefined) continue;
    if (item.tool === "lemma_preview") {
      const decision = asRecord(data.preview)?.decision;
      if (typeof decision === "string") out.previewDecision = decision;
    } else if (item.tool === "lemma_buy_resolution") {
      const status = data.status;
      if (status === "purchased" || status === "recovered" || status === "already-owned") out.purchased = true;
      if (typeof data.priceAtomic === "string" && /^\d+$/.test(data.priceAtomic)) out.priceAtomic = data.priceAtomic;
      out.paymentHash = asHex32(data.paymentHash) ?? out.paymentHash;
      const activation = asRecord(data.activation);
      if (activation !== null) {
        out.warrantyStatus = typeof activation.status === "string" ? activation.status : null;
        out.warrantyTxHash = asHex32(activation.txHash);
      }
    } else if (item.tool === "lemma_apply_resolution") {
      if (data.dryRun === false) out.appliedByBridge = true;
    }
  }
  return out;
}

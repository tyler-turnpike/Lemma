import { join } from "node:path";

import type { AcceptanceRecipe, TaskKind } from "@lemma/core";

import { benchmarkRoot } from "./paths.js";

/** Where a task's acceptance test (its definition of done) comes from. */
export type AcceptanceSource =
  | { kind: "release"; release: string; testPath: string }
  | { kind: "benchmark"; file: string; testPath: string };

export type BenchmarkTask = {
  id: string;
  /** matched: a catalog release covers it; no-match: Lemma must decline and charge nothing. */
  match: "matched" | "no-match";
  fixtureId: string;
  /** Release expected to resolve it (matched) or the release whose preview must decline (no-match). */
  release: string;
  taskKind: TaskKind;
  expectedDecision: "reuse" | "adapt" | "decline";
  /** Task-specific instructions. Identical for both arms. */
  instructions: string;
  acceptance: AcceptanceSource;
  /** Present for benchmark-owned acceptance tests; release tasks use the manifest recipe. */
  recipe?: AcceptanceRecipe;
};

const SERVER_INSTRUCTIONS = [
  "This repository is a TypeScript (ESM) MCP server built on @modelcontextprotocol/sdk `McpServer.registerTool`.",
  "Add x402 payment gating to the `get_forecast` tool: each call must require a USDC payment on Arbitrum Sepolia",
  "(x402 protocol v2, `exact` scheme, network `eip155:421614`) verified and settled through a configurable x402 facilitator,",
  "using the x402 TypeScript SDK (`@x402/core`, `@x402/evm`, `@x402/mcp` 2.27.0). The `ping` tool must stay free.",
].join(" ");

const CLIENT_INSTRUCTIONS = [
  "This repository is a TypeScript (ESM) research agent that talks to MCP servers through @modelcontextprotocol/sdk `Client`.",
  "Make it an x402-paying MCP client: when a tool requires an x402 payment (protocol v2, `exact` scheme, USDC on Arbitrum Sepolia,",
  "network `eip155:421614`), it pays automatically with a viem account, but only to allowlisted recipients, only in USDC,",
  "within a per-call cap and a total budget that are enforced in code before any payment is signed, and it reports how much it has spent.",
  "Use the x402 TypeScript SDK (`@x402/core`, `@x402/evm`, `@x402/mcp` 2.27.0).",
].join(" ");

const EXPRESS_INSTRUCTIONS = [
  "This repository is a small Express 5 API (JavaScript, ESM) whose default export in src/app.js is the Express app; keep that export.",
  "Put `GET /forecast/:city` behind an x402 paywall (protocol v2, `exact` scheme, USDC on Arbitrum Sepolia, network `eip155:421614`)",
  "using the x402 TypeScript SDK (`@x402/core`, `@x402/evm` 2.27.0). Read the price in atomic USDC from `X402_PRICE_ATOMIC`,",
  "the recipient from `X402_PAY_TO` and the facilitator base URL from `X402_FACILITATOR_URL` at runtime.",
  "Unpaid requests get HTTP 402 with a `PAYMENT-REQUIRED` header; payments are verified and settled through the facilitator.",
  "Add a free `GET /health` route that returns `{ \"status\": \"ok\" }`.",
].join(" ");

export const NO_MATCH_TEST_PATH = "test/x402-forecast-paywall.test.ts";

/**
 * The frozen task set. Three matched tasks derived from the catalog fixture index
 * (exact server, exact client, boundary server) and one no-match task (Express API,
 * which the catalog's fixture index expects to be declined).
 */
export const TASKS: readonly BenchmarkTask[] = [
  {
    id: "mcp-server-paywall-exact",
    match: "matched",
    fixtureId: "mcp-server-exact",
    release: "x402-mcp-server@1.0.0",
    taskKind: "x402-paywall-mcp-server",
    expectedDecision: "reuse",
    instructions: SERVER_INSTRUCTIONS,
    acceptance: { kind: "release", release: "x402-mcp-server@1.0.0", testPath: "test/lemma-x402-paywall.test.ts" },
  },
  {
    id: "mcp-client-paying-exact",
    match: "matched",
    fixtureId: "mcp-client-exact",
    release: "x402-mcp-client@1.0.0",
    taskKind: "x402-paying-mcp-client",
    expectedDecision: "reuse",
    instructions: CLIENT_INSTRUCTIONS,
    acceptance: { kind: "release", release: "x402-mcp-client@1.0.0", testPath: "test/lemma-x402-paying-client.test.ts" },
  },
  {
    id: "mcp-server-paywall-boundary",
    match: "matched",
    fixtureId: "mcp-server-boundary",
    release: "x402-mcp-server@1.0.0",
    taskKind: "x402-paywall-mcp-server",
    expectedDecision: "adapt",
    instructions: SERVER_INSTRUCTIONS,
    acceptance: { kind: "release", release: "x402-mcp-server@1.0.0", testPath: "test/lemma-x402-paywall.test.ts" },
  },
  {
    id: "express-paywall-no-match",
    match: "no-match",
    fixtureId: "express-no-mcp",
    release: "x402-mcp-server@1.0.0",
    taskKind: "x402-paywall-mcp-server",
    expectedDecision: "decline",
    instructions: EXPRESS_INSTRUCTIONS,
    acceptance: {
      kind: "benchmark",
      file: join(benchmarkRoot(), "tasks", "express-x402-paywall", NO_MATCH_TEST_PATH),
      testPath: NO_MATCH_TEST_PATH,
    },
    recipe: { argv: [["npx", "--no", "vitest", "run", NO_MATCH_TEST_PATH]], timeoutMs: 120_000, env: ["CI"] },
  },
];

export function getTask(id: string): BenchmarkTask {
  const task = TASKS.find((t) => t.id === id);
  if (task === undefined) throw new Error(`unknown benchmark task ${id}`);
  return task;
}

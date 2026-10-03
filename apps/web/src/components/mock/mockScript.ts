// Hardcoded session for the "Lemma in use" mock. Illustrative, labelled as such in the UI; release,
// price, settlement hash, files and test counts are the real featured purchase (content.ts `featured`).

import { featured } from "../../content.js";
import { shortHex } from "../../lib/format.js";

export type MockLine =
  | { readonly kind: "prompt"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly args: string }
  | { readonly kind: "output"; readonly label: string; readonly text: string }
  | { readonly kind: "ok"; readonly text: string; readonly detail?: string }
  | { readonly kind: "diff"; readonly files: readonly { readonly path: string; readonly add: number; readonly del: number }[] }
  | { readonly kind: "card" };

export interface MockStep {
  readonly line: MockLine;
  /** Delay before this step appears, in milliseconds. */
  readonly delay: number;
}

export const mockTitle = "agent — mcp-server";

export const mockStatus = {
  left: ["Always ask", "~/apps/mcp-server"],
  right: ["feature/x402", "lemma-bridge v0.1"],
} as const;

export const mockSteps: readonly MockStep[] = [
  { delay: 400, line: { kind: "prompt", text: "Add x402 payments on Arbitrum Sepolia to this MCP server" } },
  { delay: 1900, line: { kind: "tool", name: "lemma_preview", args: "task=x402-paywall-mcp-server" } },
  { delay: 700, line: { kind: "output", label: "profile", text: "typescript · mcp-sdk 1.30.1 · zod 4.6.5 · source not sent" } },
  { delay: 800, line: { kind: "card" } },
  { delay: 1200, line: { kind: "tool", name: "lemma_buy_resolution", args: `release=${featured.release}` } },
  { delay: 600, line: { kind: "ok", text: "spend policy", detail: `${featured.priceUsdc} ≤ 0.25 per resolution · today ${featured.priceUsdc} / 1.00 USDC` } },
  { delay: 700, line: { kind: "ok", text: "x402 settled", detail: `tx ${shortHex(featured.settlementTx)} · arbitrum-sepolia` } },
  { delay: 800, line: { kind: "tool", name: "lemma_apply_resolution", args: "--preview" } },
  {
    delay: 600,
    line: {
      kind: "diff",
      files: [
        { path: "src/lemma/x402-paywall.ts", add: 89, del: 0 },
        { path: "src/server.ts", add: 7, del: 5 },
        { path: "test/lemma-x402-paywall.test.ts", add: 89, del: 0 },
      ],
    },
  },
  { delay: 700, line: { kind: "ok", text: "applied atomically", detail: "3 files · +185 −5" } },
  { delay: 800, line: { kind: "tool", name: "lemma_verify_adoption", args: "recipe=pinned" } },
  { delay: 900, line: { kind: "ok", text: "acceptance tests", detail: "4 / 4 passed" } },
  { delay: 600, line: { kind: "ok", text: "Adoption Receipt signed", detail: "warranty active · 72h claim window" } },
];

export const decisionCard = {
  decision: "REUSE",
  release: featured.release,
  rows: [
    ["Match", "exact pins · mcp-sdk 1.30.1"],
    ["Price", `${featured.priceUsdc} USDC · quoted per request`],
    ["Evidence", "lemma-bench-v1 · −72% tokens"],
    ["Warranty", "bonded · 72h claim"],
    ["Limits", "testnet · paid tools need inputSchema"],
  ],
  footnote: "Arbitrum Sepolia testnet",
} as const;

export function transcript(): string[] {
  return mockSteps.map(({ line }) => {
    switch (line.kind) {
      case "prompt":
        return `User asks the agent: ${line.text}`;
      case "tool":
        return `Agent calls ${line.name} ${line.args}`;
      case "output":
        return `${line.label}: ${line.text}`;
      case "ok":
        return `Done: ${line.text}${line.detail ? ` (${line.detail})` : ""}`;
      case "diff":
        return `Patch preview: ${line.files.map((f) => `${f.path} +${f.add} −${f.del}`).join(", ")}`;
      case "card":
        return `Lemma decision ${decisionCard.decision} for ${decisionCard.release}: ${decisionCard.rows.map(([k, v]) => `${k} ${v}`).join("; ")}`;
    }
  });
}

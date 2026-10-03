import { TASK_KINDS, formatUsdc } from "@lemma/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { BridgeError, errorMessage } from "./errors.js";
import type { Bridge } from "./operations.js";
import type { Logger, Scrubber } from "./redaction.js";

export const BRIDGE_VERSION = "0.1.0";

const Id32 = z.string().regex(/^0x[0-9a-f]{64}$/, "expected a 0x-prefixed lowercase 32-byte id");

function toJsonSafe(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))) as Record<string, unknown>;
}

/** Wraps a tool body: concise text + structuredContent on success, explicit scrubbed error otherwise. */
function tool(scrub: Scrubber, log: Logger, name: string, body: () => Promise<{ text: string; data: unknown }>): Promise<CallToolResult> {
  return body().then(
    ({ text, data }) => {
      const structuredContent = scrub.value(toJsonSafe(data));
      return { content: [{ type: "text" as const, text: scrub.string(text) }], structuredContent };
    },
    (error: unknown) => {
      const code = error instanceof BridgeError ? error.code : "internal";
      const message = scrub.string(errorMessage(error));
      log.error(`${name} failed`, { code, message });
      return {
        isError: true,
        content: [{ type: "text" as const, text: `${name} failed (${code}): ${message}` }],
        structuredContent: { error: { code, message } },
      };
    },
  );
}

export function createBridgeServer(bridge: Bridge, scrub: Scrubber, log: Logger): McpServer {
  const server = new McpServer({ name: "lemma-mcp", version: BRIDGE_VERSION });

  server.registerTool(
    "lemma_wallet",
    {
      title: "Lemma: buyer wallet, balances and spend caps",
      description:
        "Shows the local buyer wallet address, its USDC and ETH balances on Arbitrum Sepolia, the local per-resolution and daily USDC caps, today's spend, and where to get test funds. Free; never reveals the key.",
    },
    () =>
      tool(scrub, log, "lemma_wallet", async () => {
        const r = await bridge.wallet();
        const f = r.funding;
        const lines =
          r.address === null
            ? ["No buyer wallet is configured; set BUYER_PRIVATE_KEY (or run lemma-mcp without it to get a local burner wallet)."]
            : [
                `Wallet ${r.address} (${r.wallet.kind === "burner" ? `local burner, ${r.wallet.file}` : "from BUYER_PRIVATE_KEY"}) on Arbitrum Sepolia`,
                r.balances === null ? `Balances: unavailable (${r.balanceNote ?? "unknown"})` : `Balances: ${r.balances.usdc} USDC, ${r.balances.eth} ETH`,
                `Caps: ${r.caps.perResolutionUsdc} USDC per resolution, ${r.caps.dailyUsdc} USDC per day; spent today ${r.spentTodayUsdc} USDC`,
                `Fund ${r.address} with test USDC (${f.usdcFaucet}, ${f.usdcFaucetNote}) and a little Sepolia ETH for gas (${f.ethFaucet}).`,
              ];
        return { text: lines.join("\n"), data: r };
      }),
  );

  server.registerTool(
    "lemma_preview",
    {
      title: "Lemma: free compatibility preview",
      description:
        "Builds a profile of the workspace from allowlisted metadata only (package.json, lockfile digest; never source) and asks Lemma whether a verified, warranted resolution exists for the task. Free. Returns the decision (reuse/adapt/build/decline), price, warranty and whether local spend policy would allow buying.",
      inputSchema: {
        kind: z.enum(TASK_KINDS).describe("Task kind to resolve"),
      },
    },
    ({ kind }) =>
      tool(scrub, log, "lemma_preview", async () => {
        const r = await bridge.preview(kind);
        const p = r.preview;
        const lines = [
          `Decision: ${p.decision}${p.release !== null ? ` (${p.release})` : ""}`,
          `previewId: ${p.previewId}`,
          ...(r.local.priceUsdc !== null ? [`Price: ${r.local.priceUsdc} USDC; warranty bond ${p.warranty ? formatUsdc(BigInt(p.warranty.bondAtomic)) : "n/a"} USDC`] : []),
          ...p.reasons.slice(0, 5).map((x) => `- ${x}`),
          r.local.purchaseAllowedByLocalPolicy
            ? "Local policy: purchase allowed. Call lemma_buy_resolution with this previewId to buy."
            : `Local policy: purchase not allowed (${r.local.policyReasons.join("; ")}).`,
        ];
        return { text: lines.join("\n"), data: r };
      }),
  );

  server.registerTool(
    "lemma_buy_resolution",
    {
      title: "Lemma: buy a previewed resolution",
      description:
        "Buys the resolution for a previewId. Enforces the local per-resolution and daily USDC caps and checks network, token, recipient and amount against the preview before signing any x402 payment. Verifies the payload digest and provider voucher signature, activates the on-chain warranty, and stores the resolution locally. Never pays twice: a lost response is recovered.",
      inputSchema: { previewId: Id32.describe("previewId returned by lemma_preview") },
    },
    ({ previewId }) =>
      tool(scrub, log, "lemma_buy_resolution", async () => {
        const r = await bridge.buy(previewId);
        const a = r.activation;
        const lines = [
          `${r.status === "purchased" ? "Purchased" : r.status === "recovered" ? "Recovered (no second payment)" : "Already owned"}: ${r.release} for ${r.priceUsdc} USDC`,
          `resolutionId: ${r.resolutionId}`,
          `payment tx: ${r.paymentHash}`,
          `Verified payload digest ${r.payloadDigest} and provider voucher signer ${r.voucherSigner}.`,
          a === null ? "Warranty: not activated" : `Warranty: ${a.status}${a.txHash ? ` (tx ${a.txHash})` : ""}${a.reason ? ` - ${a.reason}` : ""}`,
          `Files: ${r.files.map((f) => `${f.op} ${f.path}`).join(", ")}`,
          "Next: lemma_apply_resolution (dry run by default, apply: true to write).",
        ];
        return { text: lines.join("\n"), data: r };
      }),
  );

  server.registerTool(
    "lemma_apply_resolution",
    {
      title: "Lemma: preview or apply a resolution patch",
      description:
        "Previews (default) or atomically applies a purchased resolution's patch bundle to the workspace. Paths are confined to the workspace; drift from the reviewed base stops application before any write.",
      inputSchema: {
        resolutionId: Id32.describe("resolutionId returned by lemma_buy_resolution"),
        apply: z.boolean().optional().describe("Set true to write files. Defaults to false (dry run)."),
      },
    },
    ({ resolutionId, apply }) =>
      tool(scrub, log, "lemma_apply_resolution", async () => {
        const r = await bridge.apply(resolutionId, apply === true);
        const lines = [
          r.dryRun ? "Dry run (nothing written). Call again with apply: true to write." : `Applied ${r.filesChanged} file(s).`,
          ...r.changes.map((c) => `- ${c.op} ${c.path}: ${c.status}`),
          ...r.dependencyChanges.map((d) => `- package.json ${d.section}: ${d.name}@${d.version}`),
          ...(r.dependencyChanges.length > 0 && !r.dryRun ? ["Run your package manager install before verifying."] : []),
        ];
        return { text: lines.join("\n"), data: r };
      }),
  );

  server.registerTool(
    "lemma_verify_adoption",
    {
      title: "Lemma: run acceptance and sign an adoption receipt",
      description:
        "Runs the resolution's catalog-pinned acceptance recipe (no shell, allowlisted env, timeout), then signs an Adoption Receipt (passed/failed) with the buyer wallet and submits it to Lemma.",
      inputSchema: { resolutionId: Id32.describe("resolutionId returned by lemma_buy_resolution") },
    },
    ({ resolutionId }) =>
      tool(scrub, log, "lemma_verify_adoption", async () => {
        const r = await bridge.verifyAdoption(resolutionId);
        const t = r.receipt.testSummary;
        const lines = [
          `Acceptance ${r.outcome}: ${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped (exit ${t.exitCode ?? "n/a"}, ${t.durationMs} ms)`,
          r.submitted ? `Signed receipt submitted (receiptId ${r.receiptId ?? "n/a"}).` : `Signed receipt saved locally but not submitted: ${r.submitError ?? "unknown error"}`,
        ];
        return { text: lines.join("\n"), data: r };
      }),
  );

  return server;
}

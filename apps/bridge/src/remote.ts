import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { x402MCPClient } from "@x402/mcp";
import type { LocalAccount } from "viem";

import { BridgeError } from "./errors.js";
import { PURCHASE_TOOL, type PaymentGuard } from "./policy.js";

export type TransportFactory = () => Transport;

export type PurchaseOutcome = {
  payload: unknown;
  paymentMade: boolean;
  settlementTx: string | null;
};

/** The hosted Lemma MCP endpoint, as the bridge sees it. */
export interface RemoteLemma {
  preview(input: { task: unknown; profile: unknown }): Promise<unknown>;
  /** Paid call. Payment is created only if `guard` approves it. */
  purchase(input: { previewId: string; buyer: string }, guard: PaymentGuard, timeoutMs: number): Promise<PurchaseOutcome>;
  recover(input: { previewId: string; buyer: string }, timeoutMs: number): Promise<unknown>;
  submitReceipt(signed: unknown): Promise<unknown>;
}

/** A remote tool answered with isError (e.g. refused before payment). Message is server text. */
export class RemoteToolError extends BridgeError {
  /** Server error code when the server used the `{ error: { code, message } }` shape. */
  readonly serverCode: string | null;
  readonly serverMessage: string;
  constructor(
    readonly toolName: string,
    rawText: string,
  ) {
    const { code, message } = parseServerError(rawText);
    super("remote", `remote ${toolName} failed${code !== null ? ` (${code})` : ""}: ${message.slice(0, 500)}`);
    this.serverCode = code;
    this.serverMessage = message;
  }
}

function parseServerError(text: string): { code: string | null; message: string } {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
    if (typeof parsed.error?.message === "string") {
      return { code: typeof parsed.error.code === "string" ? parsed.error.code : null, message: parsed.error.message };
    }
  } catch {
    // plain-text error
  }
  return { code: null, message: text };
}

export function httpTransportFactory(mcpUrl: string): TransportFactory {
  // The SDK class omits `| undefined` on optional members; it is a Transport at runtime.
  return () => new StreamableHTTPClientTransport(new URL(mcpUrl)) as unknown as Transport;
}

function parseToolJson(toolName: string, result: { content: Array<{ type: string; [k: string]: unknown }>; isError?: boolean }): unknown {
  const first = result.content.find((c) => c.type === "text");
  const text = typeof first?.["text"] === "string" ? first["text"] : "";
  if (result.isError === true) throw new RemoteToolError(toolName, text || "no error message");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BridgeError("remote", `remote ${toolName} returned non-JSON content`);
  }
}

/**
 * Remote client over MCP Streamable HTTP, wrapped with the x402 MCP client. Each call opens a
 * fresh session so a dropped connection never leaves stale state behind.
 */
export class McpRemoteLemma implements RemoteLemma {
  constructor(
    private readonly transportFactory: TransportFactory,
    private readonly buyer: LocalAccount | null,
    private readonly config: { network: string; usdcAddress: string; perResolutionCapAtomic: bigint },
    private readonly defaultTimeoutMs = 60_000,
  ) {}

  private async open(guard: PaymentGuard | null): Promise<x402MCPClient> {
    const schemes = guard !== null && this.buyer !== null ? [{ network: this.config.network as `${string}:${string}`, client: new ExactEvmScheme(this.buyer) }] : [];
    const payments = x402Client.fromConfig({
      schemes,
      ...(guard !== null ? { policies: [guard.policy] } : {}),
      spendControls: {
        maxAmountPerPayment: false,
        allowedAssets: [{ network: this.config.network as `${string}:${string}`, asset: this.config.usdcAddress, maxAmountPerPayment: this.config.perResolutionCapAtomic.toString() }],
      },
    });
    if (guard !== null) payments.onBeforePaymentCreation(guard.beforePaymentCreation);
    const client = new x402MCPClient(new Client({ name: "lemma-mcp-bridge", version: "0.1.0" }), payments, {
      autoPayment: guard !== null,
      // Free tools never pay; the paid tool pays only through the guard.
      onPaymentRequested: guard !== null ? guard.onPaymentRequested : () => false,
    });
    try {
      await client.connect(this.transportFactory());
    } catch (error) {
      throw new BridgeError("remote", `cannot reach the Lemma server (${error instanceof Error ? error.message : String(error)})`);
    }
    return client;
  }

  private async call(toolName: string, args: Record<string, unknown>, timeoutMs = this.defaultTimeoutMs): Promise<unknown> {
    const client = await this.open(null);
    try {
      const result = await client.callTool(toolName, args, { timeout: timeoutMs });
      if (result.paymentMade) throw new BridgeError("payment", `unexpected payment on free tool ${toolName}`);
      return parseToolJson(toolName, result);
    } catch (error) {
      if (error instanceof Error && /Payment request denied|Payment required/.test(error.message)) {
        throw new BridgeError("payment", `free tool ${toolName} unexpectedly requested payment; refused`);
      }
      throw error;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  preview(input: { task: unknown; profile: unknown }): Promise<unknown> {
    return this.call("lemma_preview", input);
  }

  recover(input: { previewId: string; buyer: string }, timeoutMs: number): Promise<unknown> {
    return this.call("lemma_recover_resolution", input, timeoutMs);
  }

  submitReceipt(signed: unknown): Promise<unknown> {
    return this.call("lemma_submit_receipt", signed as Record<string, unknown>);
  }

  async purchase(input: { previewId: string; buyer: string }, guard: PaymentGuard, timeoutMs: number): Promise<PurchaseOutcome> {
    if (this.buyer === null) throw new BridgeError("config", "BUYER_PRIVATE_KEY is not configured");
    const client = await this.open(guard);
    try {
      const result = await client.callTool(PURCHASE_TOOL, { ...input }, { timeout: timeoutMs });
      return {
        payload: parseToolJson(PURCHASE_TOOL, result),
        paymentMade: result.paymentMade,
        settlementTx: result.paymentResponse?.transaction ?? null,
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}

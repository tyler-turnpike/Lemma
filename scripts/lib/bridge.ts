/**
 * Drives the real `lemma-mcp` bridge exactly as a coding agent does: spawn the bin over stdio
 * with the MCP SDK client and call its four tools.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

import { BRIDGE_ENTRY } from "./server.js";

export type BridgeEnv = {
  LEMMA_API_URL: string;
  LEMMA_WORKSPACE: string;
  BUYER_PRIVATE_KEY: string;
  LEMMA_PROVIDER_ADDRESS: string;
  RESOLUTION_WARRANTY_REGISTRY_ADDRESS: string;
  ARBITRUM_SEPOLIA_RPC_URL: string;
  LEMMA_STATE_DIR: string;
  LEMMA_MAX_USDC_PER_RESOLUTION?: string;
  LEMMA_DAILY_USDC_CAP?: string;
};

export type ToolOutcome<T = Record<string, unknown>> =
  | { ok: true; text: string; data: T }
  | { ok: false; text: string; error: { code: string; message: string } };

export class BridgeSession {
  private constructor(
    private readonly client: Client,
    private readonly transport: StdioClientTransport,
  ) {}

  /** Spawns `node apps/bridge/dist/index.js` (the lemma-mcp bin) with only the bridge's env. */
  static async start(env: BridgeEnv, logDir: string): Promise<BridgeSession> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BRIDGE_ENTRY],
      env: { ...getDefaultEnvironment(), ...(env as Record<string, string>) },
      stderr: "pipe",
    });
    const logFile = join(logDir, "bridge.log");
    transport.stderr?.on("data", (d: Buffer) => appendFileSync(logFile, d));
    const client = new Client({ name: "lemma-demo-agent", version: "0.1.0" });
    await client.connect(transport);
    return new BridgeSession(client, transport);
  }

  async tools(): Promise<string[]> {
    return (await this.client.listTools()).tools.map((t) => t.name);
  }

  async call<T = Record<string, unknown>>(name: string, args: Record<string, unknown>, timeoutMs = 300_000): Promise<ToolOutcome<T>> {
    const res = await this.client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
    const content = (res.content as Array<{ type: string; text?: string }> | undefined) ?? [];
    const text = content.find((c) => c.type === "text")?.text ?? "";
    const sc = (res.structuredContent ?? {}) as Record<string, unknown>;
    if (res.isError === true) {
      const e = (sc.error ?? {}) as { code?: string; message?: string };
      return { ok: false, text, error: { code: e.code ?? "unknown", message: e.message ?? text } };
    }
    return { ok: true, text, data: sc as T };
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => undefined);
    await this.transport.close().catch(() => undefined);
  }
}

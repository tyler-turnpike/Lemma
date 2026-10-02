import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, buyerKey, provider, tempDir } from "./helpers.js";

describe("lemma-mcp stdio entrypoint", () => {
  it("starts, lists the four bridge tools, and keeps the key out of stderr", async () => {
    const stderr: string[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", join(REPO_ROOT, "apps/bridge/src/index.ts")],
      cwd: REPO_ROOT,
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: await tempDir(),
        LEMMA_STATE_DIR: await tempDir(),
        LEMMA_API_URL: "http://127.0.0.1:9",
        BUYER_PRIVATE_KEY: buyerKey,
        LEMMA_PROVIDER_ADDRESS: provider.address,
      },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (d: Buffer) => stderr.push(d.toString()));
    const client = new Client({ name: "smoke", version: "0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["lemma_apply_resolution", "lemma_buy_resolution", "lemma_preview", "lemma_verify_adoption"]);
    const r = (await client.callTool({ name: "lemma_preview", arguments: { kind: "x402-paywall-mcp-server" } })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true); // server unreachable: explicit error, no crash
    expect(r.content[0]!.text).toMatch(/lemma_preview failed \(remote\)/);
    await client.close();
    const all = stderr.join("") + JSON.stringify(r);
    expect(all).toContain("lemma-mcp ready");
    expect(all.includes(buyerKey.slice(2))).toBe(false);
  }, 30_000);
});

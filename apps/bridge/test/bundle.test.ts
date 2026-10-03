import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, tempDir } from "./helpers.js";

const BUNDLE = join(REPO_ROOT, "apps/bridge/pack/dist/lemma-mcp.mjs");

// Runs only after `npm run pack -w @lemma/bridge` has produced the bundle.
describe("bundled lemma-mcp (zero config)", () => {
  it.skipIf(!existsSync(BUNDLE))("starts without env, creates a burner wallet and serves lemma_wallet", async () => {
    const home = await tempDir("lemma-home-");
    const stderr: string[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BUNDLE],
      cwd: await tempDir("lemma-cwd-"),
      env: { PATH: process.env["PATH"] ?? "", HOME: await tempDir(), LEMMA_HOME: home, LEMMA_WORKSPACE: await tempDir("lemma-ws-") },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (d: Buffer) => stderr.push(d.toString()));
    const client = new Client({ name: "smoke", version: "0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["lemma_apply_resolution", "lemma_buy_resolution", "lemma_preview", "lemma_verify_adoption", "lemma_wallet"]);
      // Balances may be null offline; the RPC read is bounded, so this never hangs.
      const r = (await client.callTool({ name: "lemma_wallet", arguments: {} })) as unknown as { isError?: boolean; structuredContent: { address: string; wallet: { kind: string; file: string } } };
      expect(r.isError).toBeUndefined();
      expect(r.structuredContent.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(r.structuredContent.wallet).toEqual({ kind: "burner", file: join(home, "wallet.json") });
      if (process.platform !== "win32") expect((await stat(join(home, "wallet.json"))).mode & 0o777).toBe(0o600);
      const log = stderr.join("");
      expect(log).toContain(`created burner wallet ${r.structuredContent.address}`);
      expect(log).toContain("lemma-mcp ready");
      expect(log).not.toMatch(/0x[0-9a-fA-F]{64}/);
    } finally {
      await client.close();
    }
  }, 30_000);
});

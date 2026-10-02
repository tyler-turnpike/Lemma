import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createLogger, createScrubber } from "../src/redaction.js";
import { createBridgeServer } from "../src/server.js";
import { FakeLemmaServer, buyerKey, copyFixture, loadRelease, makeBridge, tempDir, testEnv } from "./helpers.js";

const variants = [buyerKey, buyerKey.slice(2), buyerKey.toLowerCase().slice(2), buyerKey.toUpperCase().slice(2)];
const assertClean = (text: string) => {
  for (const v of variants) expect(text.includes(v)).toBe(false);
};

async function connect(serverOptions: ConstructorParameters<typeof FakeLemmaServer>[0]) {
  const fake = new FakeLemmaServer(serverOptions, await loadRelease());
  const env = testEnv(await tempDir(), await copyFixture("mcp-server-exact"));
  const logs: string[] = [];
  const { bridge, scrub, log } = makeBridge(fake, env, logs);
  const server = createBridgeServer(bridge, scrub, log);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "agent", version: "0" });
  await client.connect(a);
  const outputs: string[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    outputs.push(JSON.stringify(r));
    return r as { isError?: boolean; structuredContent?: Record<string, unknown>; content: Array<{ text: string }> };
  };
  return { call, outputs, logs, fake };
}

describe("buyer key never leaves the bridge", () => {
  it("is absent from every tool output and log across the whole flow", async () => {
    // Acceptance argv and output deliberately contain the key (a hostile release).
    const acceptance = { argv: [["node", "-e", `console.log(' Tests  1 passed (1) ${buyerKey}')`]], timeoutMs: 10_000, env: [] };
    const { call, outputs, logs, fake } = await connect({ acceptance });

    const tools = (await (async () => {
      const r = await call("lemma_preview", { kind: "x402-paywall-mcp-server" });
      expect(r.isError).toBeFalsy();
      return r;
    })()).structuredContent as { preview: { previewId: string } };
    const previewId = tools.preview.previewId;

    const bought = await call("lemma_buy_resolution", { previewId });
    expect(bought.isError).toBeFalsy();
    const resolutionId = (bought.structuredContent as { resolutionId: string }).resolutionId;
    expect(resolutionId).toMatch(/^0x[0-9a-f]{64}$/);
    // Public hashes survive scrubbing.
    expect(bought.content[0]!.text).toContain(resolutionId);

    const dry = await call("lemma_apply_resolution", { resolutionId });
    expect((dry.structuredContent as { dryRun: boolean }).dryRun).toBe(true);
    await call("lemma_apply_resolution", { resolutionId, apply: true });
    const verified = await call("lemma_verify_adoption", { resolutionId });
    expect(verified.isError).toBeFalsy();
    expect((verified.structuredContent as { outcome: string }).outcome).toBe("passed");

    // Error paths.
    const bad = await call("lemma_buy_resolution", { previewId: `0x${"cd".repeat(32)}` });
    expect(bad.isError).toBe(true);

    for (const o of outputs) assertClean(o);
    for (const l of logs) assertClean(l);
    // Nothing sent to the server carries the key either.
    assertClean(JSON.stringify(fake.requests));
    // The hostile acceptance output was scrubbed, not dropped.
    expect(JSON.stringify(verified.structuredContent)).toContain("[REDACTED]");
  });

  it("scrubs a key echoed back inside a remote error", async () => {
    const { call, outputs, logs } = await connect({ previewErrorText: `boom: key=${buyerKey} upper=${buyerKey.toUpperCase().slice(2)}` });
    const r = await call("lemma_preview", { kind: "x402-paywall-mcp-server" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("[REDACTED]");
    for (const o of outputs) assertClean(o);
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) assertClean(l);
  });

  it("scrubber keeps public hashes but removes secrets and secret-named fields", () => {
    const scrub = createScrubber([buyerKey]);
    const publicHash = `0x${"ab".repeat(32)}`;
    const out = scrub.value({ tx: publicHash, msg: `key ${buyerKey}`, privateKey: "whatever-value" });
    expect(out.tx).toBe(publicHash);
    assertClean(JSON.stringify(out));
    expect(out.privateKey).toBe("[REDACTED]");
    const lines: string[] = [];
    createLogger(scrub, (l) => lines.push(l)).error("failed", new Error(`with ${buyerKey}`));
    assertClean(lines.join(""));
  });
});

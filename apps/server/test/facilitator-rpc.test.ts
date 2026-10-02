import { loadCatalog } from "@lemma/catalog";
import { Preview, type TaskRequest } from "@lemma/core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { silentLogger } from "../src/log.js";
import { resilientGetCode } from "../src/payments/facilitator.js";
import { MemoryRepository } from "../src/repository/memory.js";
import { connectMcp, connectPayingMcp, makeConfig, makeKeys } from "./helpers.js";

const catalog = loadCatalog();
const task: TaskRequest = { schemaVersion: "1", kind: "x402-paywall-mcp-server", network: "arbitrum-sepolia" };

describe("self-hosted facilitator when the RPC is unreachable", () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  afterEach(() => {
    process.off("unhandledRejection", onRejection);
  });

  it("rejects the payment before settlement without an unhandled rejection (server stays up)", async () => {
    process.on("unhandledRejection", onRejection);
    const keys = makeKeys();
    const facilitatorKey = generatePrivateKey();
    const config = makeConfig(keys, {
      // Nothing listens on port 1: every RPC call fails, like a TLS/proxy or provider outage.
      ARBITRUM_SEPOLIA_RPC_URL: "http://127.0.0.1:1",
      FACILITATOR_PRIVATE_KEY: facilitatorKey,
      FACILITATOR_ADDRESS: privateKeyToAccount(facilitatorKey).address,
    });
    const { app, paidDisabledReason } = createApp({ config, repo: new MemoryRepository(), catalog, logger: silentLogger, webDistDir: null });
    expect(paidDisabledReason).toBeNull();
    const free = await connectMcp(app);
    const preview = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile: catalog.fixtureProfile("mcp-server-exact") } })).structuredContent);
    const paying = await connectPayingMcp(app, keys.buyer, () => undefined);
    const result = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: keys.buyer.address });
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text) as { x402Version?: number; error?: string };
    expect(body.x402Version).toBe(2);
    expect(body.error).not.toMatch(/^Payment settlement failed/);
    // Let any dangling library promise settle, then require that none escaped.
    await new Promise((r) => setTimeout(r, 200));
    expect(rejections).toEqual([]);
  }, 30_000);

  it("resilientGetCode retries and never rejects", async () => {
    let calls = 0;
    const flaky = { getCode: async (): Promise<`0x${string}` | undefined> => (++calls < 2 ? Promise.reject(new Error("fetch failed")) : "0x60") };
    const errors: string[] = [];
    expect(await resilientGetCode(flaky, { attempts: 3, delayMs: 1, onError: (m) => errors.push(m) })({ address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" })).toBe("0x60");
    expect(calls).toBe(2);
    const dead = { getCode: async (): Promise<`0x${string}` | undefined> => Promise.reject(new Error("fetch failed")) };
    await expect(resilientGetCode(dead, { attempts: 2, delayMs: 1, onError: (m) => errors.push(m) })({ address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" })).resolves.toBeUndefined();
    expect(errors.at(-1)).toMatch(/fetch failed/);
  });
});

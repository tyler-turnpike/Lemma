import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { assembleBridge } from "../src/bridge.js";
import { createBridgeServer } from "../src/server.js";
import { loadOrCreateBurnerWallet } from "../src/wallet.js";
import { FakeLemmaServer, REPO_ROOT, buyer, buyerKey, loadRelease, makeBridge, tempDir, testEnv } from "./helpers.js";

const run = promisify(execFile);
const isPosix = process.platform !== "win32";

describe("burner wallet", () => {
  it("creates wallet.json (dir 0700, file 0600) with a key matching its address", async () => {
    const dir = join(await tempDir(), "nested", ".lemma");
    const w = loadOrCreateBurnerWallet(dir, () => new Date("2026-01-02T03:04:05.000Z"));
    expect(w.created).toBe(true);
    expect(w.file).toBe(join(dir, "wallet.json"));
    const body = JSON.parse(await readFile(w.file, "utf8")) as Record<string, string>;
    expect(body).toEqual({ address: w.address, privateKey: w.privateKey, createdAt: "2026-01-02T03:04:05.000Z", network: "arbitrum-sepolia" });
    expect(privateKeyToAccount(w.privateKey).address).toBe(w.address);
    if (isPosix) {
      expect((await stat(w.file)).mode & 0o777).toBe(0o600);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
    }
  });

  it("reuses an existing wallet instead of replacing it", async () => {
    const dir = await tempDir();
    const first = loadOrCreateBurnerWallet(dir);
    const second = loadOrCreateBurnerWallet(dir);
    expect(second.created).toBe(false);
    expect(second.address).toBe(first.address);
    expect(second.privateKey).toBe(first.privateKey);
  });

  it("refuses a malformed or mismatched file without overwriting it or echoing it", async () => {
    const dir = await tempDir();
    const file = join(dir, "wallet.json");
    await writeFile(file, "{ not json");
    expect(() => loadOrCreateBurnerWallet(dir)).toThrow(/malformed/);
    expect(await readFile(file, "utf8")).toBe("{ not json");

    const mismatched = { address: "0x0000000000000000000000000000000000000001", privateKey: buyerKey, createdAt: "x", network: "arbitrum-sepolia" };
    await writeFile(file, JSON.stringify(mismatched));
    let message = "";
    try {
      loadOrCreateBurnerWallet(dir);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/does not match/);
    expect(message.includes(buyerKey.slice(2))).toBe(false);
  });

  it("converges on one wallet when several processes race to create it (EEXIST)", async () => {
    const dir = join(await tempDir(), ".lemma");
    await mkdir(dir, { recursive: true });
    const script = `import { loadOrCreateBurnerWallet } from ${JSON.stringify(join(REPO_ROOT, "apps/bridge/src/wallet.ts"))}; process.stdout.write(loadOrCreateBurnerWallet(${JSON.stringify(dir)}).address);`;
    const outs = await Promise.all(
      Array.from({ length: 4 }, () => run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: REPO_ROOT })),
    );
    const addresses = new Set(outs.map((o) => o.stdout.trim()));
    expect(addresses.size).toBe(1);
    const body = JSON.parse(await readFile(join(dir, "wallet.json"), "utf8")) as { address: string };
    expect(addresses.has(body.address)).toBe(true);
  }, 30_000);
});

describe("lemma_wallet tool", () => {
  async function connect(extra: Parameters<typeof makeBridge>[3]) {
    const env = testEnv(await tempDir(), await tempDir("lemma-ws-"));
    const fake = new FakeLemmaServer({}, await loadRelease());
    const { bridge, scrub, log } = makeBridge(fake, env, [], extra);
    const server = createBridgeServer(bridge, scrub, log);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "agent", version: "0" });
    await client.connect(a);
    return client;
  }

  it("reports address, balances, caps, spend and funding links without the key", async () => {
    const client = await connect({ balances: async () => ({ usdcAtomic: 1_500_000n, wei: 10n ** 15n }), walletSource: { kind: "burner", file: "/h/.lemma/wallet.json" } });
    const r = (await client.callTool({ name: "lemma_wallet", arguments: {} })) as { isError?: boolean; structuredContent: Record<string, unknown>; content: Array<{ text: string }> };
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({
      address: buyer.address,
      balances: { usdc: "1.5", usdcAtomic: "1500000", eth: "0.001", wei: "1000000000000000" },
      wallet: { kind: "burner", file: "/h/.lemma/wallet.json" },
      caps: { perResolutionUsdc: "0.25", dailyUsdc: "1" },
      spentTodayUsdc: "0",
      funding: { usdcFaucet: "https://faucet.circle.com", ethFaucet: "https://www.alchemy.com/faucets/arbitrum-sepolia" },
    });
    expect(r.content[0]!.text).toContain(`Fund ${buyer.address} with test USDC (https://faucet.circle.com`);
    expect(JSON.stringify(r).includes(buyerKey.slice(2))).toBe(false);
  });

  it("returns null balances with a note when the RPC fails", async () => {
    const client = await connect({ balances: async () => Promise.reject(new Error("connect ECONNREFUSED")) });
    const r = (await client.callTool({ name: "lemma_wallet", arguments: {} })) as { isError?: boolean; structuredContent: Record<string, unknown> };
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent["balances"]).toBeNull();
    expect(String(r.structuredContent["balanceNote"])).toMatch(/ECONNREFUSED/);
  });
});

describe("assembled bridge", () => {
  it("asks a roots-capable client for the workspace when no env var names it", async () => {
    const root = await tempDir("lemma-root-");
    const { server, bridge } = assembleBridge({ env: { LEMMA_STATE_DIR: await tempDir() }, cwd: await tempDir("lemma-cwd-"), logSink: () => undefined });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "agent", version: "0" }, { capabilities: { roots: {} } });
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: pathToFileURL(root).href, name: "project" }] }));
    await client.connect(a);
    expect(await bridge.workspace()).toBe(root);
  });

  it("uses the burner key only when BUYER_PRIVATE_KEY is unset, and scrubs it", async () => {
    const burner = loadOrCreateBurnerWallet(await tempDir());
    const withBurner = assembleBridge({ env: { LEMMA_STATE_DIR: await tempDir() }, burner, logSink: () => undefined });
    expect(withBurner.buyerAddress).toBe(burner.address);
    expect(withBurner.scrub.string(`k=${burner.privateKey}`)).not.toContain(burner.privateKey.slice(2));
    const withEnv = assembleBridge({ env: { LEMMA_STATE_DIR: await tempDir(), BUYER_PRIVATE_KEY: buyerKey }, burner, logSink: () => undefined });
    expect(withEnv.buyerAddress).toBe(buyer.address);
  });
});

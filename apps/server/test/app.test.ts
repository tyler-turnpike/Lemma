import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createApp } from "../src/app.js";
import { ConfigError, loadConfig } from "../src/config.js";
import { createLogger, silentLogger } from "../src/log.js";
import { MemoryRepository } from "../src/repository/memory.js";
import { FakeFacilitator, makeConfig, makeKeys } from "./helpers.js";

const keys = makeKeys();
const base = () => ({ repo: new MemoryRepository(), logger: silentLogger, webDistDir: null });

describe("config", () => {
  it("rejects an address that does not match its key, without echoing the key", () => {
    const key = generatePrivateKey();
    const other = privateKeyToAccount(generatePrivateKey()).address;
    let message = "";
    try {
      loadConfig({ PROVIDER_PRIVATE_KEY: key, PROVIDER_ADDRESS: other });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      message = (error as Error).message;
    }
    expect(message).toContain("PROVIDER_ADDRESS does not match");
    expect(message).not.toContain(key.slice(2));
  });

  it("treats empty variables as unset and defaults provisional override to false", () => {
    const c = loadConfig({ PROVIDER_PRIVATE_KEY: "", FACILITATOR_ADDRESS: "", RESOLUTION_WARRANTY_REGISTRY_ADDRESS: "" });
    expect(c.provider.key).toBeUndefined();
    expect(c.allowProvisional).toBe(false);
    expect(c.network).toBe("eip155:421614");
  });

  it("rejects a non-Arbitrum-Sepolia USDC address and malformed keys", () => {
    expect(() => loadConfig({ USDC_ADDRESS: "0x0000000000000000000000000000000000000001" })).toThrow(ConfigError);
    expect(() => loadConfig({ PROVIDER_PRIVATE_KEY: "0x1234" })).toThrow(ConfigError);
  });

  it("requires DATABASE_URL in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
  });
});

describe("http app", () => {
  const { app } = createApp({ ...base(), config: makeConfig(keys), facilitatorClient: new FakeFacilitator() });

  it("serves /health with no-store and security headers", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: "0.1.0" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("only allows the public origin via CORS", async () => {
    const good = await app.request("/api/v1/status", { headers: { Origin: "https://lemma.example" } });
    expect(good.headers.get("access-control-allow-origin")).toBe("https://lemma.example");
    const bad = await app.request("/api/v1/status", { headers: { Origin: "https://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("reports public addresses and the trust notice, never secrets", async () => {
    const res = await app.request("/api/v1/status");
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body.provider).toBe(keys.provider.address);
    expect(body.usdc).toBe("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
    expect(body.paidTools).toEqual({ enabled: true, reason: null });
    expect(JSON.stringify(body.trust)).toContain("team-operated key");
    expect(JSON.stringify(body.trust)).toContain("testnet only");
    expect(text).not.toContain(keys.providerKey.slice(2));
  });

  it("lists releases without bundles and looks them up by id or releaseId", async () => {
    const list = (await (await app.request("/api/v1/releases")).json()) as { releases: Array<Record<string, unknown>> };
    expect(list.releases.length).toBeGreaterThan(0);
    const first = list.releases[0]!;
    expect(first).not.toHaveProperty("bundle");
    expect(JSON.stringify(list)).not.toContain("contentBase64");
    const byName = await app.request(`/api/v1/releases/${encodeURIComponent(String(first.id))}`);
    expect(byName.status).toBe(200);
    const byId = await app.request(`/api/v1/releases/${String(first.releaseId)}`);
    expect(((await byId.json()) as { id: string }).id).toBe(first.id);
    expect((await app.request("/api/v1/releases/nope@1.0.0")).status).toBe(404);
  });

  it("validates read API parameters and returns JSON 404s", async () => {
    expect((await app.request("/api/v1/resolutions/0x1234")).status).toBe(400);
    expect((await app.request(`/api/v1/resolutions/0x${"ab".repeat(32)}`)).status).toBe(404);
    expect((await app.request("/api/v1/adoption-receipts")).status).toBe(400);
    const empty = await app.request(`/api/v1/adoption-receipts?resolutionId=0x${"ab".repeat(32)}`);
    expect(await empty.json()).toEqual({ resolutionId: `0x${"ab".repeat(32)}`, receipts: [] });
    // Point at a path that cannot exist so the assertion does not depend on whether a real
    // aggregate has been published into packages/benchmark/published.
    const noAggregate = createApp({ ...base(), config: makeConfig(null), benchmarkAggregatePath: join(tmpdir(), "lemma-absent-aggregate.json") }).app;
    expect(await (await noAggregate.request("/api/v1/benchmarks")).json()).toEqual({ status: "not-run" });
    const missing = await app.request("/api/v1/nope");
    expect(missing.status).toBe(404);
  });

  it("rejects GET on the stateless MCP endpoint", async () => {
    expect((await app.request("/mcp")).status).toBe(405);
  });

  it("exposes facilitator supported kinds and enforces the payment policy", async () => {
    const supported = (await (await app.request("/facilitator/supported")).json()) as { kinds: Array<{ network: string }> };
    expect(supported.kinds[0]?.network).toBe("eip155:421614");
    const res = await app.request("/facilitator/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: { x402Version: 2, payload: {}, accepted: {} },
        paymentRequirements: { scheme: "exact", network: "eip155:421614", asset: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", amount: "1", payTo: "0x000000000000000000000000000000000000dEaD", maxTimeoutSeconds: 60, extra: {} },
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, errorReason: "unsupported payTo" });
  });

  it("limits facilitator body size", async () => {
    const res = await app.request("/facilitator/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pad: "x".repeat(70_000) }),
    });
    expect(res.status).toBe(413);
  });
});

describe("degraded configuration", () => {
  it("disables paid tools with a clear reason but keeps read APIs", async () => {
    const { app, paidDisabledReason } = createApp({ ...base(), config: makeConfig(null) });
    expect(paidDisabledReason).toContain("PROVIDER_PRIVATE_KEY");
    const status = (await (await app.request("/api/v1/status")).json()) as { paidTools: { enabled: boolean } };
    expect(status.paidTools.enabled).toBe(false);
    expect((await app.request("/api/v1/releases")).status).toBe(200);
    expect((await app.request("/facilitator/supported")).status).toBe(503);
  });

  it("returns 503 health when the database is unreachable", async () => {
    const repo = new MemoryRepository();
    repo.ping = async () => false;
    const { app } = createApp({ repo, logger: silentLogger, webDistDir: null, config: makeConfig(null) });
    expect((await app.request("/health")).status).toBe(503);
  });
});

describe("hardening", () => {
  it("rejects oversized MCP bodies", async () => {
    const { app } = createApp({ ...base(), config: makeConfig(null) });
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(300_000) } }),
    });
    expect(res.status).toBe(413);
  });

  it("hides internal errors behind a generic 500", async () => {
    const repo = new MemoryRepository();
    repo.getResolution = async () => {
      throw new Error("db exploded at /srv/secret/path");
    };
    const { app } = createApp({ repo, logger: silentLogger, webDistDir: null, config: makeConfig(null) });
    const res = await app.request(`/api/v1/resolutions/0x${"ab".repeat(32)}`);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("exploded");
    expect(text).not.toContain("at ");
    expect(JSON.parse(text)).toEqual({ error: { code: "internal_error", message: "internal error" } });
  });

  it("redacts secrets from log lines", () => {
    const key = generatePrivateKey();
    const lines: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      createLogger({ secrets: [key] }).info(`loaded ${key}`, { privateKey: key, nested: { note: `k=${key.slice(2)}` } });
    } finally {
      process.stdout.write = orig;
    }
    const tx = `0x${"ab".repeat(32)}`;
    process.stdout.write = ((chunk: string) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      createLogger({ secrets: [key] }).info("settled", { tx, other: `0x${"cd".repeat(32)}`, publicHex: [tx] });
    } finally {
      process.stdout.write = orig;
    }
    const out = lines.join("");
    expect(out).toContain(tx);
    expect(out).not.toContain("cd".repeat(32));
    expect(out).not.toContain("publicHex");
    expect(out).not.toContain(key.slice(2));
    expect(out).toContain("[REDACTED]");
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After once the window budget is spent", async () => {
    const { app } = createApp({ ...base(), config: makeConfig(null), rateLimits: { api: 2 } });
    expect((await app.request("/api/v1/status")).status).toBe(200);
    expect((await app.request("/api/v1/status")).status).toBe(200);
    const limited = await app.request("/api/v1/status");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
  });
});

describe("static dashboard", () => {
  const dir = mkdtempSync(join(tmpdir(), "lemma-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Lemma</title>");
  writeFileSync(join(dir, "assets", "app-abc.js"), "console.log(1)");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const { app } = createApp({ repo: new MemoryRepository(), logger: silentLogger, config: makeConfig(null), webDistDir: dir });

  it("serves assets and falls back to index.html for client routes", async () => {
    const asset = await app.request("/assets/app-abc.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const spa = await app.request("/resolutions/abc");
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("<title>Lemma</title>");
    expect((await app.request("/api/v1/nope")).status).toBe(404);
    expect((await app.request("/../etc/passwd")).status).toBe(200); // normalized to SPA shell, never a file outside root
  });
});

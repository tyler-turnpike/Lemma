import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCatalog, type Catalog } from "@lemma/catalog";
import { ARBITRUM_SEPOLIA, Bytes32 } from "@lemma/core";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { serveStatic } from "@hono/node-server/serve-static";
import type { FacilitatorClient } from "@x402/core/server";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

import { paidDisabledReason, type ServerConfig } from "./config.js";
import { clientIpResolver, noStore, rateLimit, securityHeaders } from "./http/security.js";
import { createLogger, type Logger } from "./log.js";
import { SERVER_INFO, createMcpServer } from "./mcp.js";
import { createLocalFacilitator, inProcessFacilitatorClient, policyViolation, type PaymentPolicy } from "./payments/facilitator.js";
import { PaymentGateway } from "./payments/x402.js";
import type { Repository } from "./repository/types.js";
import { LemmaService, type Signing } from "./service.js";

export const SERVER_VERSION = SERVER_INFO.version;

export const TRUST_NOTICE =
  "Testnet only (Arbitrum Sepolia, test USDC). The evaluator is a team-operated key, not decentralized arbitration; the server and provider are first-party infrastructure. Lemma demonstrates an economic mechanism, not trustless software correctness.";

const MCP_MAX_BODY = 256 * 1024;
const FACILITATOR_MAX_BODY = 64 * 1024;

export type AppDeps = {
  config: ServerConfig;
  repo: Repository;
  catalog?: Catalog;
  logger?: Logger;
  now?: () => Date;
  /** Overrides the self-hosted facilitator (tests inject a fake verify/settle client). */
  facilitatorClient?: FacilitatorClient;
  /** Directory with the built dashboard (index.html + assets). Defaults to apps/web/dist. */
  webDistDir?: string | null;
  /** Published benchmark aggregate JSON file. */
  benchmarkAggregatePath?: string;
  rateLimits?: { mcp?: number; facilitator?: number; api?: number; windowMs?: number };
};

export type AppHandle = {
  app: Hono;
  service: LemmaService;
  gateway: PaymentGateway | undefined;
  paidDisabledReason: string | null;
  facilitatorAddress: string | undefined;
};

const serverRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

export function createApp(deps: AppDeps): AppHandle {
  const { config, repo } = deps;
  const catalog = deps.catalog ?? loadCatalog();
  const logger = deps.logger ?? createLogger({ secrets: config.secrets });
  const now = deps.now ?? (() => new Date());

  // ---- payments --------------------------------------------------------------
  const policy: PaymentPolicy | undefined =
    config.provider.address === undefined ? undefined : { network: config.network, asset: config.usdc, payTo: config.provider.address };

  let facilitatorClient = deps.facilitatorClient;
  let facilitatorAddress = config.facilitator.address;
  if (facilitatorClient === undefined && policy !== undefined && config.facilitator.key !== undefined && config.rpcUrl !== undefined) {
    const local = createLocalFacilitator({
      privateKey: config.facilitator.key.privateKey,
      rpcUrl: config.rpcUrl,
      policy,
      onRpcError: (message) => logger.error("facilitator RPC failure", { message }),
    });
    facilitatorClient = inProcessFacilitatorClient(local.facilitator);
    facilitatorAddress = local.address;
  }

  const signing: Signing | undefined =
    config.provider.key !== undefined && config.registry !== undefined
      ? { provider: privateKeyToAccount(config.provider.key.privateKey), registry: config.registry, chainId: config.chainId, network: config.network }
      : undefined;

  const disabledReason = paidDisabledReason(config, facilitatorClient !== undefined);
  const service = new LemmaService({ repo, catalog, now, logger, allowProvisional: config.allowProvisional, signing });
  const gateway =
    disabledReason === null && facilitatorClient !== undefined && policy !== undefined
      ? new PaymentGateway(
          facilitatorClient,
          policy,
          (ctx) => service.onSettled(ctx),
          (ctx) => service.onSuccessFeeSettled(ctx),
        )
      : undefined;
  if (disabledReason !== null) logger.warn(disabledReason);

  // ---- app -------------------------------------------------------------------
  const app = new Hono();
  const clientIp = clientIpResolver(config.trustProxy);
  const windowMs = deps.rateLimits?.windowMs ?? 60_000;
  const publicOrigin = new URL(config.publicBaseUrl).origin;

  app.onError((error, c) => {
    logger.error("unhandled request error", { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
    c.header("Cache-Control", "no-store");
    return c.json({ error: { code: "internal_error", message: "internal error" } }, 500);
  });

  app.use("*", securityHeaders({ https: config.publicBaseUrl.startsWith("https://") }));
  for (const path of ["/api/*", "/mcp", "/facilitator/*", "/health"]) {
    app.use(path, noStore());
    app.use(path, cors({ origin: [publicOrigin], allowMethods: ["GET", "POST"], allowHeaders: ["Content-Type", "Accept", "Mcp-Protocol-Version"], maxAge: 600 }));
  }
  app.use("/mcp", rateLimit({ name: "mcp", windowMs, max: deps.rateLimits?.mcp ?? 120, clientIp }));
  app.use("/facilitator/*", rateLimit({ name: "facilitator", windowMs, max: deps.rateLimits?.facilitator ?? 60, clientIp }));
  app.use("/api/*", rateLimit({ name: "api", windowMs, max: deps.rateLimits?.api ?? 300, clientIp }));
  const tooLarge = bodyLimit({
    maxSize: FACILITATOR_MAX_BODY,
    onError: (c) => c.json({ error: { code: "payload_too_large", message: "request body too large" } }, 413),
  });
  app.use("/facilitator/*", tooLarge);

  // ---- health + read API ----------------------------------------------------------
  app.get("/health", async (c) => {
    const ok = await repo.ping();
    return c.json({ ok, version: SERVER_VERSION }, ok ? 200 : 503);
  });

  app.get("/api/v1/status", (c) =>
    c.json({
      version: SERVER_VERSION,
      chain: { network: ARBITRUM_SEPOLIA.network, chainId: config.chainId, caip2: config.network },
      usdc: config.usdc,
      registry: config.registry ?? null,
      provider: config.provider.address ?? null,
      facilitator: facilitatorAddress ?? null,
      evaluator: config.evaluator ?? null,
      paidTools: { enabled: gateway !== undefined, reason: disabledReason },
      provisionalOverride: config.allowProvisional,
      trust: { evaluator: "team-operated key", network: "testnet only", notice: TRUST_NOTICE },
    }),
  );

  const releaseSummary = (id: string) => {
    const r = catalog.getRelease(id);
    if (r === undefined) return undefined;
    const m = r.manifest;
    return {
      id: m.id,
      releaseId: r.releaseId,
      name: m.name,
      version: m.version,
      title: m.title,
      summary: m.summary,
      taskKind: m.taskKind,
      network: m.network,
      supportedProfile: m.supportedProfile,
      provenance: m.provenance,
      payloadDigest: r.payloadDigest,
      fileCount: m.patch.operations.length,
      acceptance: m.acceptance,
      priceAtomic: m.priceAtomic,
      bondAtomic: m.bondAtomic,
      claimWindowSeconds: m.claimWindowSeconds,
      expiresAt: m.expiresAt,
      evidence: m.evidence,
      limitations: m.limitations,
    };
  };

  app.get("/api/v1/releases", (c) => c.json({ releases: catalog.listReleases().map((m) => releaseSummary(m.id)) }));
  app.get("/api/v1/releases/:id", (c) => {
    const id = c.req.param("id");
    if (id.length > 140) return c.json({ error: { code: "not_found", message: "release not found" } }, 404);
    const summary = releaseSummary(id);
    return summary === undefined ? c.json({ error: { code: "not_found", message: "release not found" } }, 404) : c.json(summary);
  });

  app.get("/api/v1/resolutions/:resolutionId", async (c) => {
    const id = Bytes32.safeParse(c.req.param("resolutionId").toLowerCase());
    if (!id.success) return c.json({ error: { code: "invalid_input", message: "resolutionId must be 32-byte hex" } }, 400);
    const r = await repo.getResolution(id.data);
    if (r === undefined) return c.json({ error: { code: "not_found", message: "resolution not found" } }, 404);
    const [settlement, voucher, receipts, preview, fee] = await Promise.all([
      repo.getSettlementForResolution(r.resolutionId),
      repo.getVoucher(r.resolutionId),
      repo.listAdoptionReceipts(r.resolutionId),
      repo.getPreview(r.previewId),
      repo.getSuccessFee(r.resolutionId),
    ]);
    const quote = preview?.preview.quote ?? null;
    const latest = receipts.at(-1);
    // Summary only: never the patch bundle or acceptance internals.
    return c.json({
      resolutionId: r.resolutionId,
      release: r.release,
      releaseId: r.releaseId,
      buyer: r.buyer,
      priceAtomic: r.priceAtomic,
      status: r.status,
      paymentHash: r.paymentHash,
      payloadDigest: r.payloadDigest,
      issuedAt: r.resolution?.issuedAt ?? null,
      expiresAt: r.resolution?.expiresAt ?? null,
      payment: settlement === undefined ? null : { txHash: settlement.txHash, network: settlement.network, payer: settlement.payer, amountAtomic: settlement.amountAtomic, settledAt: settlement.settledAt.toISOString() },
      voucher: voucher?.signed ?? null,
      receipts: { count: receipts.length, latestOutcome: latest?.outcome ?? null, latestAt: latest?.createdAt.toISOString() ?? null },
      quote: quote === null ? null : { model: quote.model, floorAtomic: quote.floorAtomic, successFeeAtomic: quote.successFeeAtomic, totalAtomic: quote.totalAtomic },
      successFee: fee === undefined ? null : { txHash: fee.txHash, amountAtomic: fee.amountAtomic, settledAt: fee.settledAt.toISOString() },
    });
  });

  app.get("/api/v1/adoption-receipts", async (c) => {
    const id = Bytes32.safeParse((c.req.query("resolutionId") ?? "").toLowerCase());
    if (!id.success) return c.json({ error: { code: "invalid_input", message: "resolutionId query parameter must be 32-byte hex" } }, 400);
    const receipts = await repo.listAdoptionReceipts(id.data);
    return c.json({
      resolutionId: id.data,
      receipts: receipts.map((r) => ({
        receiptId: r.receiptId,
        outcome: r.outcome,
        buyer: r.buyer,
        digest: r.digest,
        signature: r.signed.signature,
        testSummary: r.signed.receipt.testSummary,
        filesChanged: r.signed.receipt.filesChanged,
        evidenceDigest: r.signed.receipt.evidenceDigest,
        signedAt: r.signed.receipt.signedAt,
        receivedAt: r.createdAt.toISOString(),
      })),
    });
  });

  const benchmarkPath = deps.benchmarkAggregatePath ?? resolvePath(serverRoot, "..", "..", "packages", "benchmark", "published", "aggregate.json");
  app.get("/api/v1/benchmarks", (c) => {
    try {
      if (existsSync(benchmarkPath)) return c.json({ status: "published", aggregate: JSON.parse(readFileSync(benchmarkPath, "utf8")) as unknown });
    } catch (error) {
      logger.warn("benchmark aggregate unreadable", { error: error instanceof Error ? error.message : String(error) });
    }
    return c.json({ status: "not-run" });
  });

  app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "not found" } }, 404));

  // ---- facilitator ------------------------------------------------------------------
  const FacilitatorRequest = z.object({
    x402Version: z.number().int(),
    paymentPayload: z.record(z.string(), z.unknown()),
    paymentRequirements: z.object({
      scheme: z.string(),
      network: z.string(),
      asset: z.string(),
      amount: z.string(),
      payTo: z.string(),
      maxTimeoutSeconds: z.number(),
      extra: z.record(z.string(), z.unknown()),
    }),
  });
  const facilitatorUnavailable = (c: Context) =>
    c.json({ error: { code: "facilitator_disabled", message: "facilitator is not configured" } }, 503);

  app.get("/facilitator/supported", async (c) => {
    if (facilitatorClient === undefined) return facilitatorUnavailable(c);
    return c.json(await facilitatorClient.getSupported());
  });
  for (const op of ["verify", "settle"] as const) {
    app.post(`/facilitator/${op}`, async (c) => {
      if (facilitatorClient === undefined || policy === undefined) return facilitatorUnavailable(c);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: { code: "invalid_input", message: "expected JSON" } }, 400);
      }
      const parsed = FacilitatorRequest.safeParse(body);
      if (!parsed.success) return c.json({ error: { code: "invalid_input", message: "invalid facilitator request" } }, 400);
      const requirements = { ...parsed.data.paymentRequirements, network: parsed.data.paymentRequirements.network as `${string}:${string}` };
      const violation = policyViolation(policy, requirements);
      if (violation !== null) {
        return op === "verify"
          ? c.json({ isValid: false, invalidReason: violation }, 400)
          : c.json({ success: false, errorReason: violation, transaction: "", network: requirements.network }, 400);
      }
      const payload = parsed.data.paymentPayload as unknown as Parameters<FacilitatorClient["verify"]>[0];
      try {
        return op === "verify" ? c.json(await facilitatorClient.verify(payload, requirements)) : c.json(await facilitatorClient.settle(payload, requirements));
      } catch (error) {
        logger.warn(`facilitator ${op} failed`, { error: error instanceof Error ? error.message : String(error) });
        return op === "verify"
          ? c.json({ isValid: false, invalidReason: "verification_error" }, 400)
          : c.json({ success: false, errorReason: "settlement_error", transaction: "", network: requirements.network }, 400);
      }
    });
  }

  // ---- MCP (stateless Streamable HTTP, JSON responses; no sessionIdGenerator = stateless) ----
  app.post("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: MCP_MAX_BODY });
    const server = createMcpServer({ service, gateway, paidDisabledReason: disabledReason, logger });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      // JSON response mode resolves only after every response is ready.
      void server.close().catch(() => {});
    }
  });
  app.on(["GET", "DELETE", "PUT", "PATCH"], "/mcp", (c) =>
    c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server; use POST)" }, id: null }, 405),
  );

  // ---- dashboard (static, SPA fallback) -------------------------------------------------
  const webDir = deps.webDistDir === undefined ? resolvePath(serverRoot, "..", "web", "dist") : deps.webDistDir;
  if (webDir !== null && existsSync(join(webDir, "index.html"))) {
    const indexHtml = readFileSync(join(webDir, "index.html"), "utf8");
    app.use("/*", async (c, next) => {
      await next();
      if (c.res.status === 200 && !c.res.headers.has("Cache-Control")) {
        c.header("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      }
    });
    // Registered after the API routes, so only static files and the SPA shell are compressed.
    app.use("/*", compress());
    app.use("/*", serveStatic({ root: webDir }));
    app.get("*", (c) => {
      // Missing files (anything with an extension, downloads, API paths) are real 404s, never the SPA shell.
      const path = c.req.path;
      if (/^\/(facilitator|mcp|api|dl|assets)(\/|$)/.test(path) || /\.[A-Za-z0-9]{1,8}$/.test(path)) {
        return c.json({ error: { code: "not_found", message: "not found" } }, 404);
      }
      c.header("Cache-Control", "no-cache");
      return c.html(indexHtml);
    });
  }
  app.notFound((c) => c.json({ error: { code: "not_found", message: "not found" } }, 404));

  return { app, service, gateway, paidDisabledReason: disabledReason, facilitatorAddress };
}

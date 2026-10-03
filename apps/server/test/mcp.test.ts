import { loadCatalog } from "@lemma/catalog";
import { Preview, type TaskRequest } from "@lemma/core";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { silentLogger } from "../src/log.js";
import { MemoryRepository } from "../src/repository/memory.js";
import { FakeFacilitator, connectMcp, makeConfig, makeKeys, toolJson } from "./helpers.js";

const catalog = loadCatalog();
const task: TaskRequest = { schemaVersion: "1", kind: "x402-paywall-mcp-server", network: "arbitrum-sepolia" };
const exact = catalog.fixtureProfile("mcp-server-exact");
const keys = makeKeys();
const buyer = keys.buyer.address;

/** The catalog as it was before the benchmarked 1.1.0 releases: provisional evidence only. */
const provisionalOnly = { ...catalog, listReleases: () => catalog.listReleases().filter((r) => r.version === "1.0.0") };

function setup(options: { allowProvisional?: boolean; paid?: boolean; now?: () => Date; catalog?: typeof catalog } = {}) {
  const repo = new MemoryRepository();
  const facilitator = new FakeFacilitator();
  const config = makeConfig(options.paid === false ? null : keys, { LEMMA_ALLOW_PROVISIONAL: options.allowProvisional === false ? "false" : "true" });
  const handle = createApp({
    config,
    repo,
    catalog: options.catalog ?? catalog,
    logger: silentLogger,
    webDistDir: null,
    facilitatorClient: facilitator,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { ...handle, repo, facilitator };
}

describe("remote MCP over Streamable HTTP", () => {
  it("lists the four contract tools, each with an inputSchema", async () => {
    const { app } = setup();
    const client = await connectMcp(app);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["lemma_preview", "lemma_purchase_resolution", "lemma_recover_resolution", "lemma_submit_receipt"]);
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
    await client.close();
  });

  it("returns a persisted, schema-valid preview with a high-entropy id", async () => {
    const { app, repo } = setup();
    const client = await connectMcp(app);
    const result = await client.callTool({ name: "lemma_preview", arguments: { task, profile: exact } });
    expect(result.isError).toBeFalsy();
    const preview = Preview.parse(result.structuredContent);
    expect(toolJson(result)).toEqual(result.structuredContent);
    expect(preview.decision).toBe("reuse");
    expect(preview.purchasable).toBe(true);
    expect(preview.priceAtomic).toBe("5000");
    expect((await repo.getPreview(preview.previewId))?.preview).toEqual(preview);
    // Two identical previews in the same second still get distinct ids.
    const again = Preview.parse((await client.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    expect(again.previewId).not.toBe(preview.previewId);
    await client.close();
  });

  it("rejects invalid preview input at the schema boundary", async () => {
    const { app } = setup();
    const client = await connectMcp(app);
    const result = await client.callTool({ name: "lemma_preview", arguments: { task: { ...task, kind: "rm -rf" }, profile: exact } });
    expect(result.isError).toBe(true);
    await client.close();
  });
});

describe("purchase gating (refuses before any payment is requested)", () => {
  const purchase = async (app: Parameters<typeof connectMcp>[0], args: Record<string, unknown>) => {
    const client = await connectMcp(app);
    try {
      return await client.callTool({ name: "lemma_purchase_resolution", arguments: args });
    } finally {
      await client.close();
    }
  };

  it("refuses an unknown preview", async () => {
    const { app, facilitator } = setup();
    const result = await purchase(app, { previewId: `0x${"11".repeat(32)}`, buyer });
    expect(result.isError).toBe(true);
    expect(toolJson(result)).toMatchObject({ error: { code: "preview_not_found" } });
    expect(facilitator.verifyCalls).toHaveLength(0);
  });

  it("refuses a non-purchasable preview (provisional evidence without the override)", async () => {
    const { app } = setup({ allowProvisional: false, catalog: provisionalOnly });
    const client = await connectMcp(app);
    const preview = Preview.parse((await client.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    expect(preview.release).toBe("x402-mcp-server@1.0.0");
    expect(preview.purchasable).toBe(false);
    const result = await client.callTool({ name: "lemma_purchase_resolution", arguments: { previewId: preview.previewId, buyer } });
    expect(toolJson(result)).toMatchObject({ error: { code: "not_purchasable" } });
    await client.close();
  });

  it("refuses a build/decline preview", async () => {
    const { app } = setup();
    const client = await connectMcp(app);
    const preview = Preview.parse(
      (await client.callTool({ name: "lemma_preview", arguments: { task: { ...task, kind: "x402-facilitator-hono" }, profile: exact } })).structuredContent,
    );
    expect(preview.decision).toBe("build");
    const result = await client.callTool({ name: "lemma_purchase_resolution", arguments: { previewId: preview.previewId, buyer } });
    expect(toolJson(result)).toMatchObject({ error: { code: "not_purchasable" } });
    await client.close();
  });

  it("refuses an expired preview", async () => {
    let t = new Date("2026-10-02T12:00:00Z");
    const { app } = setup({ now: () => t });
    const client = await connectMcp(app);
    const preview = Preview.parse((await client.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    t = new Date(t.getTime() + 31 * 60 * 1000);
    const result = await client.callTool({ name: "lemma_purchase_resolution", arguments: { previewId: preview.previewId, buyer } });
    expect(toolJson(result)).toMatchObject({ error: { code: "preview_expired" } });
    await client.close();
  });

  it("says clearly when paid tools are disabled, while preview still works", async () => {
    const { app } = setup({ paid: false });
    const client = await connectMcp(app);
    const preview = Preview.parse((await client.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    const result = await client.callTool({ name: "lemma_purchase_resolution", arguments: { previewId: preview.previewId, buyer } });
    expect(toolJson(result)).toMatchObject({ error: { code: "paid_tools_disabled" } });
    expect(JSON.stringify(toolJson(result))).toContain("PROVIDER_PRIVATE_KEY");
    await client.close();
  });

  it("returns an x402 PaymentRequired challenge whose amount equals the preview price", async () => {
    const { app } = setup();
    const client = await connectMcp(app);
    const preview = Preview.parse((await client.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    const result = await client.callTool({ name: "lemma_purchase_resolution", arguments: { previewId: preview.previewId, buyer } });
    expect(result.isError).toBe(true);
    const required = result.structuredContent as { x402Version: number; accepts: Array<Record<string, unknown>> };
    expect(required.x402Version).toBe(2);
    expect(required.accepts).toHaveLength(1);
    expect(required.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:421614",
      amount: preview.priceAtomic,
      asset: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      payTo: keys.provider.address,
      extra: { name: "USD Coin", version: "2" },
    });
    await client.close();
  });

  it("recovery of an unknown purchase returns { found: false }", async () => {
    const { app } = setup();
    const client = await connectMcp(app);
    const result = await client.callTool({ name: "lemma_recover_resolution", arguments: { previewId: `0x${"22".repeat(32)}`, buyer } });
    expect(result.structuredContent).toEqual({ found: false });
    await client.close();
  });
});

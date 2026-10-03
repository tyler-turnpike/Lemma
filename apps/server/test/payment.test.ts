import { loadCatalog } from "@lemma/catalog";
import {
  CompatibilityResolution,
  Preview,
  SignedResolutionVoucher,
  adoptionReceiptDigest,
  bundleDigest,
  lemmaDomain,
  voucherTypedData,
  voucherTypedDataHash,
  type AdoptionReceipt,
  type TaskRequest,
} from "@lemma/core";
import { recoverAddress, recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { silentLogger } from "../src/log.js";
import { MemoryRepository } from "../src/repository/memory.js";
import { FakeFacilitator, REGISTRY, connectMcp, connectPayingMcp, makeConfig, makeKeys, toolJson } from "./helpers.js";

const catalog = loadCatalog();
const task: TaskRequest = { schemaVersion: "1", kind: "x402-paywall-mcp-server", network: "arbitrum-sepolia" };
const exact = catalog.fixtureProfile("mcp-server-exact");

async function purchaseFlow(pricing?: { model: string }) {
  const keys = makeKeys();
  const repo = new MemoryRepository();
  const facilitator = new FakeFacilitator();
  const { app } = createApp({ config: makeConfig(keys), repo, catalog, logger: silentLogger, webDistDir: null, facilitatorClient: facilitator });
  const free = await connectMcp(app);
  const preview = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile: exact, ...(pricing === undefined ? {} : { pricing }) } })).structuredContent);
  const requested: string[] = [];
  const paying = await connectPayingMcp(app, keys.buyer, (amount) => requested.push(amount));
  const result = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: keys.buyer.address });
  return { keys, repo, facilitator, app, free, paying, preview, requested, result };
}

describe("x402 purchase with a fake facilitator", () => {
  it("charges exactly the preview price and returns a voucher bound to the settlement tx", async () => {
    const { keys, facilitator, preview, requested, result, free, paying } = await purchaseFlow();
    expect(result.isError).toBeFalsy();
    expect(result.paymentMade).toBe(true);

    // Payment requirement amount == preview price, paid to the provider in Arbitrum Sepolia USDC.
    expect(requested).toEqual([preview.priceAtomic]);
    expect(facilitator.settleCalls).toHaveLength(1);
    const settled = facilitator.settleCalls[0]!;
    expect(settled.requirements.amount).toBe(preview.priceAtomic);
    expect(settled.requirements.payTo).toBe(keys.provider.address);
    expect(settled.requirements.network).toBe("eip155:421614");
    expect(result.paymentResponse?.transaction).toBe(settled.tx);

    const body = toolJson(result) as { resolution: unknown; voucher: unknown };
    const resolution = CompatibilityResolution.parse(body.resolution);
    const voucher = SignedResolutionVoucher.parse(body.voucher);

    // paymentHash is the real settlement transaction hash, in both objects.
    expect(resolution.paymentHash).toBe(settled.tx.toLowerCase());
    expect(voucher.voucher.paymentHash).toBe(resolution.paymentHash);

    // Payload digest matches the delivered bundle and the catalog release.
    expect(resolution.payloadDigest).toBe(bundleDigest(resolution.bundle));
    expect(voucher.voucher.payloadDigest).toBe(bundleDigest(resolution.bundle));
    expect(resolution.payloadDigest).toBe(catalog.getRelease(resolution.release)?.payloadDigest);

    // Amount, buyer, release and expiry semantics.
    expect(voucher.voucher.amount).toBe(preview.priceAtomic);
    expect(resolution.priceAtomic).toBe(preview.priceAtomic);
    expect(voucher.voucher.buyer).toBe(keys.buyer.address);
    expect(voucher.voucher.releaseId).toBe(preview.releaseId);
    expect(voucher.voucher.resolutionId).toBe(resolution.resolutionId);
    expect(Number(voucher.voucher.expiresAt)).toBe(Date.parse(resolution.expiresAt) / 1000);
    expect(Number(voucher.voucher.expiresAt) - Date.parse(resolution.issuedAt) / 1000).toBe(24 * 3600);

    // Signed by the provider over the EIP-712 ResolutionVoucher with the registry domain.
    const domain = lemmaDomain(REGISTRY, 421614);
    expect(voucher.chainId).toBe(421614);
    expect(voucher.verifyingContract).toBe(REGISTRY);
    expect(voucher.signer).toBe(keys.provider.address);
    const recovered = await recoverTypedDataAddress({ ...voucherTypedData(domain, voucher.voucher), signature: voucher.signature as Hex });
    expect(recovered).toBe(keys.provider.address);
    expect(await recoverAddress({ hash: voucherTypedDataHash(domain, voucher.voucher), signature: voucher.signature as Hex })).toBe(keys.provider.address);

    await free.close();
    await paying.close();
  });

  it("recovers the identical resolution and voucher without another settlement", async () => {
    const { facilitator, preview, keys, result, free, paying } = await purchaseFlow();
    const first = toolJson(result);
    const recovered = await free.callTool({ name: "lemma_recover_resolution", arguments: { previewId: preview.previewId, buyer: keys.buyer.address } });
    expect(recovered.structuredContent).toEqual(first);
    // Lower-case buyer address resolves to the same purchase.
    const lower = await free.callTool({ name: "lemma_recover_resolution", arguments: { previewId: preview.previewId, buyer: keys.buyer.address.toLowerCase() } });
    expect(lower.structuredContent).toEqual(first);
    expect(facilitator.settleCalls).toHaveLength(1);
    await free.close();
    await paying.close();
  });

  it("refuses a second purchase before payment and never settles twice", async () => {
    const { facilitator, preview, keys, paying, free } = await purchaseFlow();
    const second = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: keys.buyer.address });
    expect(second.isError).toBe(true);
    expect(second.paymentMade).toBe(false);
    const err = toolJson(second) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("already_settled");
    expect(err.error.message).toContain("lemma_recover_resolution");
    expect(facilitator.settleCalls).toHaveLength(1);
    expect(facilitator.verifyCalls).toHaveLength(1);
    await free.close();
    await paying.close();
  });

  it("persists settlement, resolution and voucher, and the read API never leaks the bundle", async () => {
    const { repo, app, result, facilitator, free, paying, preview } = await purchaseFlow();
    const body = toolJson(result) as { resolution: { resolutionId: string } };
    const id = body.resolution.resolutionId;
    const record = await repo.getResolution(id);
    expect(record?.status).toBe("settled");
    expect(await repo.getSettlement(facilitator.settleCalls[0]!.tx.toLowerCase())).toMatchObject({ resolutionId: id, amountAtomic: preview.priceAtomic });
    const res = await app.request(`/api/v1/resolutions/${id}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("contentBase64");
    expect(text).not.toContain("operations");
    const summary = JSON.parse(text) as Record<string, unknown>;
    expect(summary.status).toBe("settled");
    expect(summary.paymentHash).toBe(facilitator.settleCalls[0]!.tx.toLowerCase());
    expect(summary.voucher).toEqual((toolJson(result) as { voucher: unknown }).voucher);
    await free.close();
    await paying.close();
  });

  it("settles at most once under concurrent paid attempts for the same (previewId, buyer)", async () => {
    const keys = makeKeys();
    const facilitator = new FakeFacilitator();
    const { app } = createApp({ config: makeConfig(keys), repo: new MemoryRepository(), catalog, logger: silentLogger, webDistDir: null, facilitatorClient: facilitator });
    const free = await connectMcp(app);
    const preview = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    const clients = await Promise.all([connectPayingMcp(app, keys.buyer), connectPayingMcp(app, keys.buyer), connectPayingMcp(app, keys.buyer)]);
    const results = await Promise.all(clients.map((c) => c.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: keys.buyer.address })));
    expect(results.filter((r) => r.isError !== true)).toHaveLength(1);
    expect(facilitator.settleCalls).toHaveLength(1);
    for (const r of results.filter((x) => x.isError === true)) {
      expect(["already_settled", "purchase_in_progress"]).toContain((toolJson(r) as { error: { code: string } }).error.code);
    }
    await Promise.all([free.close(), ...clients.map((c) => c.close())]);
  });

  it("finalizes idempotently when the settlement hook fires twice", async () => {
    const { service, result, facilitator, preview, keys, free, paying } = await (async () => {
      const keys = makeKeys();
      const facilitator = new FakeFacilitator();
      const handle = createApp({ config: makeConfig(keys), repo: new MemoryRepository(), catalog, logger: silentLogger, webDistDir: null, facilitatorClient: facilitator });
      const free = await connectMcp(handle.app);
      const preview = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
      const paying = await connectPayingMcp(handle.app, keys.buyer);
      const result = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: keys.buyer.address });
      return { ...handle, result, facilitator, preview, keys, free, paying };
    })();
    const call = facilitator.settleCalls[0]!;
    await service.onSettled({
      arguments: { previewId: preview.previewId, buyer: keys.buyer.address },
      settlement: { success: true, transaction: call.tx, network: "eip155:421614", payer: keys.buyer.address },
      paymentPayload: call.payload,
      paymentRequirements: call.requirements,
    });
    const again = await service.recover(preview.previewId, keys.buyer.address);
    expect(again).toEqual(toolJson(result));
    await free.close();
    await paying.close();
  });

  it("never strands a paid buyer when persistence fails after settlement", async () => {
    const keys = makeKeys();
    const repo = new MemoryRepository();
    const facilitator = new FakeFacilitator();
    const realSettle = repo.settleResolution.bind(repo);
    let broken = true;
    repo.settleResolution = async (input) => {
      if (broken) throw new Error("database unavailable");
      return realSettle(input);
    };
    const { app } = createApp({ config: makeConfig(keys), repo, catalog, logger: silentLogger, webDistDir: null, facilitatorClient: facilitator });
    const free = await connectMcp(app);
    const preview = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    const paying = await connectPayingMcp(app, keys.buyer);
    const first = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: keys.buyer.address });
    expect(first.isError).toBe(true);
    expect(first.paymentResponse?.transaction).toBe(facilitator.settleCalls[0]!.tx);
    expect(toolJson(first)).toMatchObject({ error: { code: "settlement_unrecorded" } });

    // A retry is refused before payment: the server remembers the settlement.
    const retry = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: keys.buyer.address });
    expect(toolJson(retry)).toMatchObject({ error: { code: "already_settled" } });
    expect(facilitator.settleCalls).toHaveLength(1);

    broken = false;
    const recovered = await free.callTool({ name: "lemma_recover_resolution", arguments: { previewId: preview.previewId, buyer: keys.buyer.address } });
    const body = recovered.structuredContent as { resolution: { paymentHash: string } };
    expect(body.resolution.paymentHash).toBe(facilitator.settleCalls[0]!.tx.toLowerCase());
    await free.close();
    await paying.close();
  });

  it("refuses a payment whose payer differs from the buyer argument", async () => {
    const keys = makeKeys();
    const facilitator = new FakeFacilitator();
    const { app } = createApp({ config: makeConfig(keys), repo: new MemoryRepository(), catalog, logger: silentLogger, webDistDir: null, facilitatorClient: facilitator });
    const free = await connectMcp(app);
    const preview = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    const stranger = privateKeyToAccount(generatePrivateKey());
    const paying = await connectPayingMcp(app, stranger);
    const result = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: keys.buyer.address });
    expect(result.isError).toBe(true);
    expect(toolJson(result)).toMatchObject({ error: { code: "payer_mismatch" } });
    expect(facilitator.settleCalls).toHaveLength(0);
    await free.close();
    await paying.close();
  });

  it("leaves the purchase retryable when settlement fails", async () => {
    const keys = makeKeys();
    const repo = new MemoryRepository();
    const facilitator = new FakeFacilitator();
    facilitator.failSettle = true;
    const { app } = createApp({ config: makeConfig(keys), repo, catalog, logger: silentLogger, webDistDir: null, facilitatorClient: facilitator });
    const free = await connectMcp(app);
    const preview = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    const paying = await connectPayingMcp(app, keys.buyer);
    const failed = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: keys.buyer.address });
    expect(failed.isError).toBe(true);
    const pending = await repo.getResolutionByPreviewBuyer(preview.previewId, keys.buyer.address);
    expect(pending?.status).toBe("pending");
    expect((await free.callTool({ name: "lemma_recover_resolution", arguments: { previewId: preview.previewId, buyer: keys.buyer.address } })).structuredContent).toEqual({
      found: false,
    });

    facilitator.failSettle = false;
    const retried = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: keys.buyer.address });
    expect(retried.isError).toBeFalsy();
    const body = toolJson(retried) as { resolution: { resolutionId: string } };
    // The resolutionId pinned before the failed settlement is reused.
    expect(body.resolution.resolutionId).toBe(pending?.resolutionId);
    await free.close();
    await paying.close();
  });
});

describe("adoption receipts", () => {
  const receiptFor = (resolutionId: string, buyer: string): AdoptionReceipt => ({
    schemaVersion: "1",
    resolutionId: resolutionId as Hex,
    outcome: "passed",
    testSummary: { passed: 3, failed: 0, skipped: 0, durationMs: 1200, exitCode: 0 },
    filesChanged: 2,
    evidenceDigest: `0x${"cd".repeat(32)}`,
    buyer,
    signedAt: "2026-10-02T12:00:00Z",
  });

  it("accepts a buyer-signed receipt once, dedupes, and exposes it via the read API", async () => {
    const { keys, result, free, paying, app } = await purchaseFlow();
    const resolutionId = (toolJson(result) as { resolution: { resolutionId: string } }).resolution.resolutionId;
    const receipt = receiptFor(resolutionId, keys.buyer.address);
    const signature = await keys.buyer.signMessage({ message: { raw: adoptionReceiptDigest(receipt) } });
    const signed = { schemaVersion: "1", receipt, signature };

    const first = await free.callTool({ name: "lemma_submit_receipt", arguments: signed });
    expect(first.isError).toBeFalsy();
    const accepted = first.structuredContent as { accepted: boolean; receiptId: string };
    expect(accepted.accepted).toBe(true);
    expect(accepted.receiptId).toMatch(/^0x[0-9a-f]{64}$/);
    const dup = await free.callTool({ name: "lemma_submit_receipt", arguments: signed });
    expect((dup.structuredContent as { receiptId: string }).receiptId).toBe(accepted.receiptId);

    const list = (await (await app.request(`/api/v1/adoption-receipts?resolutionId=${resolutionId}`)).json()) as { receipts: Array<{ outcome: string }> };
    expect(list.receipts).toHaveLength(1);
    expect(list.receipts[0]?.outcome).toBe("passed");
    const summary = (await (await app.request(`/api/v1/resolutions/${resolutionId}`)).json()) as { receipts: { count: number; latestOutcome: string } };
    expect(summary.receipts).toMatchObject({ count: 1, latestOutcome: "passed" });
    await free.close();
    await paying.close();
  });

  it("rejects a receipt not signed by the buyer, or for an unknown resolution", async () => {
    const { keys, result, free, paying } = await purchaseFlow();
    const resolutionId = (toolJson(result) as { resolution: { resolutionId: string } }).resolution.resolutionId;
    const receipt = receiptFor(resolutionId, keys.buyer.address);
    const forged = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: { raw: adoptionReceiptDigest(receipt) } });
    const bad = await free.callTool({ name: "lemma_submit_receipt", arguments: { schemaVersion: "1", receipt, signature: forged } });
    expect(toolJson(bad)).toMatchObject({ error: { code: "invalid_signature" } });

    // Signature over a different receipt body does not verify (digest binding).
    const sigOther = await keys.buyer.signMessage({ message: { raw: adoptionReceiptDigest({ ...receipt, outcome: "failed" }) } });
    const swapped = await free.callTool({ name: "lemma_submit_receipt", arguments: { schemaVersion: "1", receipt, signature: sigOther } });
    expect(toolJson(swapped)).toMatchObject({ error: { code: "invalid_signature" } });

    const unknown = receiptFor(`0x${"ef".repeat(32)}`, keys.buyer.address);
    const sig = await keys.buyer.signMessage({ message: { raw: adoptionReceiptDigest(unknown) } });
    const missing = await free.callTool({ name: "lemma_submit_receipt", arguments: { schemaVersion: "1", receipt: unknown, signature: sig } });
    expect(toolJson(missing)).toMatchObject({ error: { code: "resolution_not_found" } });

    // A third party cannot attach a receipt to someone else's resolution.
    const other = privateKeyToAccount(generatePrivateKey());
    const foreign = receiptFor(resolutionId, other.address);
    const foreignSig = await other.signMessage({ message: { raw: adoptionReceiptDigest(foreign) } });
    const rejected = await free.callTool({ name: "lemma_submit_receipt", arguments: { schemaVersion: "1", receipt: foreign, signature: foreignSig } });
    expect(toolJson(rejected)).toMatchObject({ error: { code: "buyer_mismatch" } });
    await free.close();
    await paying.close();
  });
});

describe("per-request quote and success fee", () => {
  const passedReceipt = async (keys: ReturnType<typeof makeKeys>, resolutionId: string) => {
    const receipt: AdoptionReceipt = {
      schemaVersion: "1",
      resolutionId: resolutionId as Hex,
      outcome: "passed",
      testSummary: { passed: 4, failed: 0, skipped: 0, durationMs: 1200, exitCode: 0 },
      filesChanged: 3,
      evidenceDigest: `0x${"cd".repeat(32)}`,
      buyer: keys.buyer.address,
      signedAt: "2026-10-02T12:00:00Z",
    };
    return { schemaVersion: "1", receipt, signature: await keys.buyer.signMessage({ message: { raw: adoptionReceiptDigest(receipt) } }) };
  };

  it("quotes by declared model but charges only the registered price up front", async () => {
    const luna = await purchaseFlow();
    expect(luna.preview.quote).toMatchObject({ model: "gpt-5.6-luna", floorAtomic: "5000", successFeeAtomic: "1000", totalAtomic: "6000" });
    const terra = await purchaseFlow({ model: "gpt-5.6-terra" });
    expect(terra.preview.quote).toMatchObject({ model: "gpt-5.6-terra", floorAtomic: "5000", successFeeAtomic: "53000", totalAtomic: "58000" });
    expect(terra.preview.priceAtomic).toBe("5000");
    expect(terra.requested).toEqual(["5000"]);
    for (const f of [luna, terra]) {
      await f.free.close();
      await f.paying.close();
    }
  });

  it("collects the success fee once, from the buyer only, and records it", async () => {
    const { keys, app, facilitator, free, paying, result } = await purchaseFlow({ model: "gpt-5.6-terra" });
    const resolutionId = (toolJson(result) as { resolution: { resolutionId: string } }).resolution.resolutionId;

    const stranger = await connectPayingMcp(app, privateKeyToAccount(generatePrivateKey()), () => undefined);
    const wrong = await stranger.callTool("lemma_pay_success_fee", { resolutionId, buyer: privateKeyToAccount(generatePrivateKey()).address });
    expect(toolJson(wrong)).toMatchObject({ error: { code: "buyer_mismatch" } });
    await stranger.close();

    const requested: string[] = [];
    const payer = await connectPayingMcp(app, keys.buyer, (amount) => requested.push(amount));
    const fee = await payer.callTool("lemma_pay_success_fee", { resolutionId, buyer: keys.buyer.address });
    expect(fee.isError).toBeFalsy();
    expect(requested).toEqual(["53000"]);
    const settled = facilitator.settleCalls.at(-1)!;
    expect(settled.requirements.amount).toBe("53000");
    expect(settled.requirements.payTo).toBe(keys.provider.address);
    expect(toolJson(fee)).toMatchObject({ successFee: { resolutionId, amountAtomic: "53000", txHash: settled.tx.toLowerCase() } });

    const again = await payer.callTool("lemma_pay_success_fee", { resolutionId, buyer: keys.buyer.address });
    expect(toolJson(again)).toMatchObject({ error: { code: "success_fee_paid" } });
    expect(facilitator.settleCalls).toHaveLength(2);

    const summary = (await (await app.request(`/api/v1/resolutions/${resolutionId}`)).json()) as { quote: unknown; successFee: unknown };
    expect(summary.quote).toMatchObject({ model: "gpt-5.6-terra", successFeeAtomic: "53000" });
    expect(summary.successFee).toMatchObject({ amountAtomic: "53000", txHash: settled.tx.toLowerCase() });

    // Passing with the fee paid keeps the buyer in good standing.
    expect((await free.callTool({ name: "lemma_submit_receipt", arguments: await passedReceipt(keys, resolutionId) })).isError).toBeFalsy();
    const next = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    const buyAgain = await payer.callTool("lemma_purchase_resolution", { previewId: next.previewId, buyer: keys.buyer.address });
    expect(buyAgain.isError).toBeFalsy();
    await payer.close();
    await free.close();
    await paying.close();
  });

  it("refuses new sales to a buyer who reports a pass without paying the fee", async () => {
    const { keys, free, paying, result } = await purchaseFlow({ model: "gpt-5.6-terra" });
    const resolutionId = (toolJson(result) as { resolution: { resolutionId: string } }).resolution.resolutionId;
    const accepted = await free.callTool({ name: "lemma_submit_receipt", arguments: await passedReceipt(keys, resolutionId) });
    expect(accepted.isError).toBeFalsy();
    const next = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    const refused = await paying.callTool("lemma_purchase_resolution", { previewId: next.previewId, buyer: keys.buyer.address });
    expect(toolJson(refused)).toMatchObject({ error: { code: "buyer_delinquent" } });
    await free.close();
    await paying.close();
  });

  it("owes nothing after a failed adoption", async () => {
    const { keys, paying, result, free } = await purchaseFlow({ model: "gpt-5.6-terra" });
    const resolutionId = (toolJson(result) as { resolution: { resolutionId: string } }).resolution.resolutionId;
    const { receipt } = await passedReceipt(keys, resolutionId);
    const failed = { ...receipt, outcome: "failed" as const };
    const signed = { schemaVersion: "1", receipt: failed, signature: await keys.buyer.signMessage({ message: { raw: adoptionReceiptDigest(failed) } }) };
    expect((await free.callTool({ name: "lemma_submit_receipt", arguments: signed })).isError).toBeFalsy();
    const next = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile: exact } })).structuredContent);
    expect((await paying.callTool("lemma_purchase_resolution", { previewId: next.previewId, buyer: keys.buyer.address })).isError).toBeFalsy();
    await free.close();
    await paying.close();
  });
});

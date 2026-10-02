import { describe, expect, it } from "vitest";

import { verifyPurchase, type VerificationContext } from "../src/verify.js";
import { REGISTRY, buyer, loadRelease, makePreview, makePurchase, other, provider } from "./helpers.js";

async function fixture() {
  const { bundle, acceptance } = await loadRelease();
  const preview = makePreview();
  const ctx: VerificationContext = { preview, buyer: buyer.address, providerAddress: provider.address, chainId: 421614, registryAddress: REGISTRY };
  return { bundle, acceptance, preview, ctx };
}

const reasonsOf = async (p: Promise<unknown>) => {
  const e = (await p.then(
    () => null,
    (err: unknown) => err,
  )) as { code?: string; details?: string[] } | null;
  expect(e?.code).toBe("verification");
  return e?.details ?? [];
};

describe("voucher and resolution verification", () => {
  it("accepts a correct resolution and voucher", async () => {
    const { bundle, acceptance, preview, ctx } = await fixture();
    const payload = await makePurchase({ preview, buyerAddress: buyer.address, bundle, acceptance });
    const v = await verifyPurchase(payload, ctx);
    expect(v.signer.toLowerCase()).toBe(provider.address.toLowerCase());
  });

  it("rejects a voucher signed by someone other than the provider", async () => {
    const { bundle, acceptance, preview, ctx } = await fixture();
    const payload = await makePurchase({ preview, buyerAddress: buyer.address, bundle, acceptance, signer: other });
    expect(await reasonsOf(verifyPurchase(payload, ctx))).toContain("voucher signature was not made by the expected provider");
  });

  it("rejects a tampered bundle (digest mismatch)", async () => {
    const { bundle, acceptance, preview, ctx } = await fixture();
    const payload = await makePurchase({ preview, buyerAddress: buyer.address, bundle, acceptance });
    const op = payload.resolution.bundle.operations[0]!;
    const tampered = { ...payload, resolution: { ...payload.resolution, bundle: { ...payload.resolution.bundle, release: "evil@1.0.0", operations: [op, ...payload.resolution.bundle.operations.slice(1)] } } };
    expect(await reasonsOf(verifyPurchase(tampered, ctx))).toContain("bundle digest does not match resolution.payloadDigest");
  });

  it("rejects a voucher whose payloadDigest differs from the resolution", async () => {
    const { bundle, acceptance, preview, ctx } = await fixture();
    const payload = await makePurchase({ preview, buyerAddress: buyer.address, bundle, acceptance });
    payload.voucher.voucher.payloadDigest = `0x${"11".repeat(32)}` as `0x${string}`;
    const reasons = await reasonsOf(verifyPurchase(payload, ctx));
    expect(reasons).toContain("voucher payloadDigest does not match resolution.payloadDigest");
    expect(reasons).toContain("voucher signature was not made by the expected provider");
  });

  it("rejects a resolution issued to a different buyer", async () => {
    const { bundle, acceptance, preview, ctx } = await fixture();
    const payload = await makePurchase({ preview, buyerAddress: other.address, bundle, acceptance });
    const reasons = await reasonsOf(verifyPurchase(payload, ctx));
    expect(reasons).toContain("resolution buyer is not this wallet");
    expect(reasons).toContain("voucher buyer is not this wallet");
  });

  it("rejects an amount that differs from the preview price", async () => {
    const { bundle, acceptance, ctx } = await fixture();
    const cheap = makePreview({ previewId: ctx.preview.previewId }, "100000");
    const payload = await makePurchase({ preview: cheap, buyerAddress: buyer.address, bundle, acceptance });
    const reasons = await reasonsOf(verifyPurchase(payload, ctx));
    expect(reasons).toContain("voucher amount does not match the preview price");
  });

  it("rejects a voucher for a different registry and malformed payloads", async () => {
    const { bundle, acceptance, preview, ctx } = await fixture();
    const payload = await makePurchase({ preview, buyerAddress: buyer.address, bundle, acceptance, registry: other.address });
    expect(await reasonsOf(verifyPurchase(payload, ctx))).toContain("voucher verifyingContract is not the configured registry");
    await reasonsOf(verifyPurchase({ resolution: {}, voucher: {} }, ctx));
  });
});

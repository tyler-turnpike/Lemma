import {
  CompatibilityResolution,
  SignedResolutionVoucher,
  bundleDigest,
  lemmaDomain,
  verifyBundleIntegrity,
  voucherTypedData,
  type CompatibilityResolution as CompatibilityResolutionT,
  type Preview,
  type SignedResolutionVoucher as SignedResolutionVoucherT,
} from "@lemma/core";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";

import { BridgeError } from "./errors.js";

export type VerificationContext = {
  preview: Preview;
  buyer: Address;
  providerAddress: Address;
  chainId: number;
  /** When configured, the voucher must target this registry. */
  registryAddress: Address | null;
};

export type VerifiedPurchase = { resolution: CompatibilityResolutionT; voucher: SignedResolutionVoucherT; signer: Address };

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Verifies a delivered resolution + voucher before anything is stored, activated or applied:
 * schemas, bundle integrity, bundleDigest == payloadDigest (resolution and voucher), voucher
 * fields bound to the preview and to this buyer, and the EIP-712 signer == provider.
 */
export async function verifyPurchase(payload: unknown, ctx: VerificationContext): Promise<VerifiedPurchase> {
  const obj = (payload ?? {}) as Record<string, unknown>;
  const r = CompatibilityResolution.safeParse(obj["resolution"]);
  const v = SignedResolutionVoucher.safeParse(obj["voucher"]);
  const schemaProblems = [
    ...(r.success ? [] : r.error.issues.map((i) => `resolution.${i.path.join(".")}: ${i.message}`)),
    ...(v.success ? [] : v.error.issues.map((i) => `voucher.${i.path.join(".")}: ${i.message}`)),
  ];
  if (!r.success || !v.success) throw new BridgeError("verification", "delivered resolution failed schema validation", schemaProblems.slice(0, 10));
  const resolution = r.data;
  const signed = v.data;
  const msg = signed.voucher;
  const reasons: string[] = [];

  const integrity = verifyBundleIntegrity(resolution.bundle);
  reasons.push(...integrity.map((p) => `bundle: ${p}`));
  let digest: Hex | null = null;
  try {
    digest = bundleDigest(resolution.bundle);
  } catch {
    reasons.push("bundle digest could not be computed");
  }
  if (digest !== null && digest !== resolution.payloadDigest) reasons.push("bundle digest does not match resolution.payloadDigest");
  if (resolution.payloadDigest !== msg.payloadDigest) reasons.push("voucher payloadDigest does not match resolution.payloadDigest");

  const preview = ctx.preview;
  if (resolution.previewId !== preview.previewId) reasons.push("resolution is for a different preview");
  if (preview.releaseId === null || resolution.releaseId !== preview.releaseId) reasons.push("resolution release does not match the preview");
  if (msg.releaseId !== resolution.releaseId) reasons.push("voucher releaseId does not match the resolution");
  if (msg.resolutionId !== resolution.resolutionId) reasons.push("voucher resolutionId does not match the resolution");
  if (msg.paymentHash !== resolution.paymentHash) reasons.push("voucher paymentHash does not match the resolution");
  if (preview.priceAtomic === null || resolution.priceAtomic !== preview.priceAtomic) reasons.push("resolution price does not match the preview price");
  if (preview.priceAtomic === null || msg.amount !== preview.priceAtomic) reasons.push("voucher amount does not match the preview price");
  if (!eq(resolution.buyer, ctx.buyer)) reasons.push("resolution buyer is not this wallet");
  if (!eq(msg.buyer, ctx.buyer)) reasons.push("voucher buyer is not this wallet");
  if (signed.chainId !== ctx.chainId) reasons.push("voucher chainId is not Arbitrum Sepolia");
  if (ctx.registryAddress !== null && !eq(signed.verifyingContract, ctx.registryAddress)) reasons.push("voucher verifyingContract is not the configured registry");
  if (!eq(signed.signer, ctx.providerAddress)) reasons.push("voucher signer field is not the expected provider");

  let recovered: Address | null = null;
  try {
    recovered = await recoverTypedDataAddress({
      ...voucherTypedData(lemmaDomain(signed.verifyingContract as Address, signed.chainId), msg),
      signature: signed.signature as Hex,
    });
  } catch {
    reasons.push("voucher signature is malformed");
  }
  if (recovered !== null && !eq(recovered, ctx.providerAddress)) reasons.push("voucher signature was not made by the expected provider");

  if (reasons.length > 0) throw new BridgeError("verification", "delivered resolution failed verification", reasons);
  return { resolution, voucher: signed, signer: recovered as Address };
}

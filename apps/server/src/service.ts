import type { Catalog, LoadedRelease } from "@lemma/catalog";
import {
  CompatibilityResolution,
  Preview,
  SignedAdoptionReceipt,
  SignedResolutionVoucher,
  adoptionReceiptDigest,
  bundleDigest,
  lemmaDomain,
  newResolutionId,
  voucherTypedData,
  type CompatibilityResolution as CompatibilityResolutionT,
  type Preview as PreviewT,
  type RepositoryProfile,
  type ResolutionVoucherMessage,
  type SignedResolutionVoucher as SignedResolutionVoucherT,
  type TaskRequest,
} from "@lemma/core";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex, type LocalAccount } from "viem";

import type { Logger } from "./log.js";
import type { Repository, ResolutionRecord, SettlementRecord, SuccessFeeRecord } from "./repository/types.js";
import { resolve } from "./resolver.js";

/** How long a persisted preview may be purchased. */
export const PREVIEW_TTL_SECONDS = 30 * 60;
/** Voucher validity for onchain activation. */
export const VOUCHER_TTL_SECONDS = 24 * 60 * 60;
/** Tolerated clock skew for buyer-signed timestamps. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type ServiceErrorCode =
  | "invalid_input"
  | "preview_not_found"
  | "preview_expired"
  | "not_purchasable"
  | "release_unavailable"
  | "already_settled"
  | "purchase_in_progress"
  | "payer_mismatch"
  | "paid_tools_disabled"
  | "settlement_unrecorded"
  | "resolution_not_found"
  | "resolution_not_settled"
  | "invalid_signature"
  | "buyer_mismatch"
  | "buyer_delinquent"
  | "no_success_fee"
  | "success_fee_paid";

export class ServiceError extends Error {
  override name = "ServiceError";
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type PaidResult = { resolution: CompatibilityResolutionT; voucher: SignedResolutionVoucherT };
export type Signing = { provider: LocalAccount; registry: Address; chainId: number; network: string };

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const lockKey = (previewId: string, buyer: string) => `${previewId.toLowerCase()}|${buyer.toLowerCase()}`;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** Extracts the paying address from an `exact` EVM payload (EIP-3009 or Permit2). */
export function payerOf(payload: PaymentPayload): Address | undefined {
  const inner = payload.payload as { authorization?: { from?: unknown }; permit2Authorization?: { from?: unknown } };
  const from = inner.authorization?.from ?? inner.permit2Authorization?.from;
  return typeof from === "string" && isAddress(from, { strict: false }) ? getAddress(from) : undefined;
}

/**
 * Business logic behind the MCP tools: previews, purchase gating, post-settlement
 * finalization (voucher signing), recovery and adoption receipts. Transport-agnostic.
 */
export class LemmaService {
  private readonly inFlight = new Set<string>();
  /** Settlements whose persistence failed; retried by recovery so a paid buyer is never stranded. */
  private readonly unrecorded = new Map<string, { settlement: SettleResponse; payload: PaymentPayload; amount: string }>();

  constructor(
    private readonly deps: {
      repo: Repository;
      catalog: Catalog;
      now: () => Date;
      logger: Logger;
      allowProvisional: boolean;
      signing: Signing | undefined;
    },
  ) {}

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  async preview(task: TaskRequest, profile: RepositoryProfile, pricing: { model?: string | undefined } = {}): Promise<PreviewT> {
    const now = this.deps.now();
    const resolved = resolve(task, profile, this.deps.catalog, now, { allowProvisional: this.deps.allowProvisional, model: pricing.model ?? null });
    // The resolver's id is a deterministic digest; the persisted preview gets a
    // high-entropy id because previewId + buyer authorizes recovery of a paid payload.
    const preview = Preview.parse({ ...resolved, previewId: newResolutionId() });
    await this.deps.repo.savePreview({ preview, expiresAt: new Date(now.getTime() + PREVIEW_TTL_SECONDS * 1000), createdAt: now });
    return preview;
  }

  // -------------------------------------------------------------------------
  // Purchase gating (runs before any payment is requested or verified)
  // -------------------------------------------------------------------------

  async checkPurchasable(previewId: string, buyerInput: string): Promise<{ preview: PreviewT; release: LoadedRelease; buyer: Address; priceAtomic: string }> {
    const buyer = getAddress(buyerInput);
    const record = await this.deps.repo.getPreview(previewId);
    if (record === undefined) throw new ServiceError("preview_not_found", "preview not found; call lemma_preview first");
    const now = this.deps.now();
    if (record.expiresAt.getTime() <= now.getTime()) throw new ServiceError("preview_expired", "preview expired; call lemma_preview again");
    const p = record.preview;
    if (!p.purchasable || p.priceAtomic === null || p.release === null || (p.decision !== "reuse" && p.decision !== "adapt")) {
      throw new ServiceError("not_purchasable", "this preview does not offer a purchasable resolution");
    }
    const release = this.deps.catalog.getRelease(p.release);
    if (release === undefined || release.releaseId !== p.releaseId) throw new ServiceError("release_unavailable", "release is no longer in the catalog");
    if (Date.parse(release.manifest.expiresAt) <= now.getTime()) throw new ServiceError("release_unavailable", "release has expired");
    if (release.manifest.priceAtomic !== p.priceAtomic) throw new ServiceError("release_unavailable", "release price changed; call lemma_preview again");
    const existing = await this.deps.repo.getResolutionByPreviewBuyer(p.previewId, buyer);
    if (existing?.status === "settled" || this.unrecorded.has(lockKey(p.previewId, buyer))) {
      throw new ServiceError("already_settled", "already purchased for this preview and buyer; call lemma_recover_resolution");
    }
    if (await this.deps.repo.isDelinquent(buyer)) {
      throw new ServiceError("buyer_delinquent", "this buyer reported a passed adoption without paying its success fee; new sales are refused");
    }
    return { preview: p, release, buyer, priceAtomic: p.priceAtomic };
  }

  /** Serializes paid attempts per (previewId, buyer) so a second concurrent payment is refused before settlement. */
  acquire(previewId: string, buyer: string): () => void {
    const k = lockKey(previewId, buyer);
    if (this.inFlight.has(k)) throw new ServiceError("purchase_in_progress", "a purchase for this preview and buyer is in progress; retry later or call lemma_recover_resolution");
    this.inFlight.add(k);
    return () => this.inFlight.delete(k);
  }

  /** Runs after payment verification, before settlement: pins a stable resolutionId. */
  async beginPurchase(previewId: string, buyerInput: string): Promise<ResolutionRecord> {
    const { preview, release, buyer, priceAtomic } = await this.checkPurchasable(previewId, buyerInput);
    return this.deps.repo.getOrCreatePendingResolution({
      resolutionId: newResolutionId(),
      previewId: preview.previewId as Hex,
      buyer,
      release: release.manifest.id,
      releaseId: release.releaseId,
      priceAtomic,
      createdAt: this.deps.now(),
    });
  }

  // -------------------------------------------------------------------------
  // Post-settlement (x402 onAfterSettlement hook)
  // -------------------------------------------------------------------------

  /**
   * Called by the x402 wrapper after the facilitator settled. Never throws: the wrapper
   * would otherwise report "settlement failed" for a payment that did settle. Failures are
   * remembered and retried by recovery.
   */
  async onSettled(ctx: { arguments: Record<string, unknown>; settlement: SettleResponse; paymentPayload: PaymentPayload; paymentRequirements: { amount: string } }): Promise<void> {
    const previewId = String(ctx.arguments.previewId ?? "");
    const buyerRaw = String(ctx.arguments.buyer ?? "");
    if (!isAddress(buyerRaw, { strict: false })) {
      this.deps.logger.error("settlement for invalid buyer argument", { tx: ctx.settlement.transaction });
      return;
    }
    const buyer = getAddress(buyerRaw);
    const k = lockKey(previewId, buyer);
    const pending = { settlement: ctx.settlement, payload: ctx.paymentPayload, amount: ctx.paymentRequirements.amount };
    this.unrecorded.set(k, pending);
    try {
      await this.finalize(previewId, buyer, pending);
      this.unrecorded.delete(k);
    } catch (error) {
      this.deps.logger.error("CRITICAL: settled payment could not be finalized; will retry on recovery", {
        tx: ctx.settlement.transaction,
        previewId,
        buyer,
        publicHex: [ctx.settlement.transaction, previewId],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async finalize(previewId: string, buyer: Address, s: { settlement: SettleResponse; payload: PaymentPayload; amount: string }): Promise<PaidResult> {
    const signing = this.requireSigning();
    const { settlement } = s;
    if (!settlement.success) throw new Error("settlement not successful");
    if (!TX_HASH_RE.test(settlement.transaction)) throw new Error("settlement transaction hash is malformed");
    if (settlement.network !== signing.network) throw new Error("settlement on unexpected network");
    const txHash = settlement.transaction.toLowerCase() as Hex;
    const payer = settlement.payer !== undefined && isAddress(settlement.payer, { strict: false }) ? getAddress(settlement.payer) : payerOf(s.payload);
    if (payer === undefined || payer !== buyer) throw new Error("settled payer does not match buyer");

    let record = await this.deps.repo.getResolutionByPreviewBuyer(previewId, buyer);
    if (record === undefined) {
      // Handler normally creates it; recreate defensively from the persisted preview.
      const preview = await this.deps.repo.getPreview(previewId);
      if (preview?.preview.release == null || preview.preview.releaseId === null || preview.preview.priceAtomic === null) throw new Error("unknown preview for settlement");
      record = await this.deps.repo.getOrCreatePendingResolution({
        resolutionId: newResolutionId(),
        previewId: preview.preview.previewId as Hex,
        buyer,
        release: preview.preview.release,
        releaseId: preview.preview.releaseId as Hex,
        priceAtomic: preview.preview.priceAtomic,
        createdAt: this.deps.now(),
      });
    }
    const amount = settlement.amount ?? s.amount;
    if (amount !== record.priceAtomic) throw new Error("settled amount does not equal the release price");

    if (record.status !== "settled") {
      const loaded = this.deps.catalog.getRelease(record.release);
      if (loaded === undefined) throw new Error("release missing from catalog");
      const settledAt = this.deps.now();
      const expiresAt = new Date((Math.floor(settledAt.getTime() / 1000) + VOUCHER_TTL_SECONDS) * 1000);
      const resolution = CompatibilityResolution.parse({
        schemaVersion: "1",
        resolutionId: record.resolutionId,
        previewId: record.previewId,
        releaseId: loaded.releaseId,
        release: loaded.manifest.id,
        buyer,
        priceAtomic: record.priceAtomic,
        paymentHash: txHash,
        payloadDigest: bundleDigest(loaded.bundle),
        bundle: loaded.bundle,
        acceptance: loaded.manifest.acceptance,
        issuedAt: iso(settledAt),
        expiresAt: iso(expiresAt),
      });
      const settlementRecord: SettlementRecord = {
        txHash,
        resolutionId: record.resolutionId,
        network: settlement.network,
        payer,
        amountAtomic: amount,
        settledAt,
      };
      record = await this.deps.repo.settleResolution({ settlement: settlementRecord, resolution });
    } else if (record.paymentHash !== txHash) {
      throw new Error("resolution already settled with a different transaction");
    }
    return this.withVoucher(record);
  }

  /** Signs (or loads) the voucher for a settled resolution. Deterministic and idempotent. */
  private async withVoucher(record: ResolutionRecord): Promise<PaidResult> {
    const resolution = record.resolution;
    if (record.status !== "settled" || resolution === null) throw new ServiceError("resolution_not_settled", "resolution is not settled");
    const stored = await this.deps.repo.getVoucher(record.resolutionId);
    if (stored !== undefined) return { resolution, voucher: stored.signed };
    const signing = this.requireSigning();
    const message: ResolutionVoucherMessage = {
      resolutionId: resolution.resolutionId,
      releaseId: resolution.releaseId,
      buyer: resolution.buyer,
      amount: resolution.priceAtomic,
      paymentHash: resolution.paymentHash,
      payloadDigest: bundleDigest(resolution.bundle),
      expiresAt: String(Math.floor(Date.parse(resolution.expiresAt) / 1000)),
    };
    const signature = await signing.provider.signTypedData(voucherTypedData(lemmaDomain(signing.registry, signing.chainId), message));
    const signed = SignedResolutionVoucher.parse({
      schemaVersion: "1",
      chainId: signing.chainId,
      verifyingContract: signing.registry,
      signer: signing.provider.address,
      signature,
      voucher: message,
    });
    const saved = await this.deps.repo.saveVoucher({ resolutionId: record.resolutionId, signed, createdAt: this.deps.now() });
    return { resolution, voucher: saved.signed };
  }

  private requireSigning(): Signing {
    if (this.deps.signing === undefined) throw new ServiceError("paid_tools_disabled", "provider signing is not configured");
    return this.deps.signing;
  }

  // -------------------------------------------------------------------------
  // Recovery
  // -------------------------------------------------------------------------

  async recover(previewId: string, buyerInput: string): Promise<PaidResult | { found: false }> {
    const buyer = getAddress(buyerInput);
    const k = lockKey(previewId, buyer);
    const unrecorded = this.unrecorded.get(k);
    if (unrecorded !== undefined) {
      const result = await this.finalize(previewId, buyer, unrecorded);
      this.unrecorded.delete(k);
      return result;
    }
    const record = await this.deps.repo.getResolutionByPreviewBuyer(previewId, buyer);
    if (record === undefined || record.status !== "settled") return { found: false };
    return this.withVoucher(record);
  }

  // -------------------------------------------------------------------------
  // Success fee (the rest of the quote, paid only after the acceptance tests pass)
  // -------------------------------------------------------------------------

  /** Success fee the resolution's preview quoted, or null when none is owed. */
  async successFeeOwed(record: ResolutionRecord): Promise<string | null> {
    const preview = await this.deps.repo.getPreview(record.previewId);
    const fee = preview?.preview.quote?.successFeeAtomic;
    return fee === undefined || fee === "0" ? null : fee;
  }

  /** Runs before any fee payment is requested: the caller must be the buyer of a settled resolution that owes an unpaid fee. */
  async checkSuccessFee(resolutionId: string, buyerInput: string): Promise<{ resolution: ResolutionRecord; buyer: Address; amountAtomic: string }> {
    const buyer = getAddress(buyerInput);
    const resolution = await this.deps.repo.getResolution(resolutionId);
    if (resolution === undefined) throw new ServiceError("resolution_not_found", "unknown resolution");
    if (resolution.status !== "settled") throw new ServiceError("resolution_not_settled", "resolution is not settled");
    if (resolution.buyer !== buyer) throw new ServiceError("buyer_mismatch", "only the resolution's buyer pays its success fee");
    const amountAtomic = await this.successFeeOwed(resolution);
    if (amountAtomic === null) throw new ServiceError("no_success_fee", "this resolution's quote has no success fee");
    if ((await this.deps.repo.getSuccessFee(resolution.resolutionId)) !== undefined) throw new ServiceError("success_fee_paid", "the success fee is already paid");
    return { resolution, buyer, amountAtomic };
  }

  /** x402 onAfterSettlement for the success fee. Never throws (see onSettled). */
  async onSuccessFeeSettled(ctx: { arguments: Record<string, unknown>; settlement: SettleResponse; paymentPayload: PaymentPayload; paymentRequirements: { amount: string } }): Promise<void> {
    try {
      await this.recordSuccessFee(String(ctx.arguments.resolutionId ?? ""), String(ctx.arguments.buyer ?? ""), ctx);
    } catch (error) {
      this.deps.logger.error("CRITICAL: settled success fee could not be recorded", {
        tx: ctx.settlement.transaction,
        publicHex: [ctx.settlement.transaction],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async recordSuccessFee(
    resolutionId: string,
    buyerInput: string,
    ctx: { settlement: SettleResponse; paymentPayload: PaymentPayload; paymentRequirements: { amount: string } },
  ): Promise<SuccessFeeRecord> {
    const signing = this.requireSigning();
    const { settlement } = ctx;
    if (!settlement.success || !TX_HASH_RE.test(settlement.transaction)) throw new Error("settlement not successful");
    if (settlement.network !== signing.network) throw new Error("settlement on unexpected network");
    if (!isAddress(buyerInput, { strict: false })) throw new Error("invalid buyer");
    const buyer = getAddress(buyerInput);
    const payer = settlement.payer !== undefined && isAddress(settlement.payer, { strict: false }) ? getAddress(settlement.payer) : payerOf(ctx.paymentPayload);
    if (payer !== buyer) throw new Error("settled payer does not match buyer");
    const resolution = await this.deps.repo.getResolution(resolutionId);
    if (resolution === undefined || resolution.buyer !== buyer) throw new Error("unknown resolution for success fee");
    const owed = await this.successFeeOwed(resolution);
    const amount = settlement.amount ?? ctx.paymentRequirements.amount;
    if (owed === null || amount !== owed) throw new Error("settled amount does not equal the quoted success fee");
    return this.deps.repo.saveSuccessFee({
      resolutionId: resolution.resolutionId,
      buyer,
      amountAtomic: amount,
      txHash: settlement.transaction.toLowerCase() as Hex,
      network: settlement.network,
      settledAt: this.deps.now(),
    });
  }

  async getSuccessFee(resolutionId: string): Promise<SuccessFeeRecord | undefined> {
    return this.deps.repo.getSuccessFee(resolutionId);
  }

  // -------------------------------------------------------------------------
  // Adoption receipts
  // -------------------------------------------------------------------------

  async submitReceipt(input: unknown): Promise<{ accepted: true; receiptId: Hex }> {
    const parsed = SignedAdoptionReceipt.safeParse(input);
    if (!parsed.success) throw new ServiceError("invalid_input", "invalid SignedAdoptionReceipt");
    const signed = parsed.data;
    const { receipt } = signed;
    if (Date.parse(receipt.signedAt) > this.deps.now().getTime() + MAX_FUTURE_SKEW_MS) {
      throw new ServiceError("invalid_input", "receipt signedAt is in the future");
    }
    const digest = adoptionReceiptDigest(receipt);
    let recovered: Address;
    try {
      recovered = await recoverMessageAddress({ message: { raw: digest }, signature: signed.signature as Hex });
    } catch {
      throw new ServiceError("invalid_signature", "receipt signature is malformed");
    }
    const buyer = getAddress(receipt.buyer);
    if (recovered !== buyer) throw new ServiceError("invalid_signature", "receipt signature does not recover the buyer");
    const resolution = await this.deps.repo.getResolution(receipt.resolutionId);
    if (resolution === undefined) throw new ServiceError("resolution_not_found", "unknown resolution");
    if (resolution.status !== "settled") throw new ServiceError("resolution_not_settled", "resolution is not settled");
    if (resolution.buyer !== buyer) throw new ServiceError("buyer_mismatch", "receipt buyer does not match the resolution buyer");
    // A passed adoption owes the quoted success fee; reporting success without paying it ends future sales.
    if (receipt.outcome === "passed" && (await this.successFeeOwed(resolution)) !== null && (await this.deps.repo.getSuccessFee(resolution.resolutionId)) === undefined) {
      await this.deps.repo.markDelinquent({ buyer, resolutionId: resolution.resolutionId, at: this.deps.now() });
      this.deps.logger.info("buyer marked delinquent: passed receipt without its success fee", { publicHex: [buyer, resolution.resolutionId] });
    }
    const { record } = await this.deps.repo.saveAdoptionReceipt({
      receiptId: newResolutionId(),
      resolutionId: resolution.resolutionId,
      buyer,
      outcome: receipt.outcome,
      digest,
      signed,
      createdAt: this.deps.now(),
    });
    return { accepted: true, receiptId: record.receiptId };
  }
}

import type { CompatibilityResolution, Preview, SignedAdoptionReceipt, SignedResolutionVoucher } from "@lemma/core";

export type PreviewRecord = {
  preview: Preview;
  expiresAt: Date;
  createdAt: Date;
};

export type ResolutionStatus = "pending" | "settled";

/**
 * One purchase per (previewId, buyer). Created as `pending` before settlement (so the
 * resolutionId is stable across payment retries) and moved to `settled` exactly once,
 * bound to the settlement transaction hash.
 */
export type ResolutionRecord = {
  resolutionId: `0x${string}`;
  previewId: `0x${string}`;
  /** Checksummed buyer address. */
  buyer: `0x${string}`;
  release: string;
  releaseId: `0x${string}`;
  priceAtomic: string;
  status: ResolutionStatus;
  paymentHash: `0x${string}` | null;
  payloadDigest: `0x${string}` | null;
  /** Full paid object (includes the bundle). Never returned by read APIs. */
  resolution: CompatibilityResolution | null;
  createdAt: Date;
  settledAt: Date | null;
};

export type SettlementRecord = {
  txHash: `0x${string}`;
  resolutionId: `0x${string}`;
  network: string;
  payer: `0x${string}`;
  amountAtomic: string;
  settledAt: Date;
};

export type VoucherRecord = {
  resolutionId: `0x${string}`;
  signed: SignedResolutionVoucher;
  createdAt: Date;
};

export type AdoptionReceiptRecord = {
  receiptId: `0x${string}`;
  resolutionId: `0x${string}`;
  buyer: `0x${string}`;
  outcome: SignedAdoptionReceipt["receipt"]["outcome"];
  digest: `0x${string}`;
  signed: SignedAdoptionReceipt;
  createdAt: Date;
};

export type ChainCursor = { chainId: number; stream: string; blockNumber: bigint; logIndex: number; updatedAt: Date };

export class RepositoryConflictError extends Error {
  override name = "RepositoryConflictError";
}

/**
 * Persistence boundary. Every implementation must make the create/finalize operations
 * idempotent and enforce the uniqueness rules documented on each method.
 */
export interface Repository {
  /** Insert-if-absent by previewId. */
  savePreview(record: PreviewRecord): Promise<void>;
  getPreview(previewId: string): Promise<PreviewRecord | undefined>;

  /**
   * Returns the existing resolution for (previewId, buyer) or inserts `pending` with the
   * given id. Unique on (previewId, buyer).
   */
  getOrCreatePendingResolution(input: {
    resolutionId: `0x${string}`;
    previewId: `0x${string}`;
    buyer: `0x${string}`;
    release: string;
    releaseId: `0x${string}`;
    priceAtomic: string;
    createdAt: Date;
  }): Promise<ResolutionRecord>;
  getResolution(resolutionId: string): Promise<ResolutionRecord | undefined>;
  getResolutionByPreviewBuyer(previewId: string, buyer: string): Promise<ResolutionRecord | undefined>;

  /**
   * Atomically records the settlement (tx hash unique) and moves the resolution to
   * `settled`. Idempotent for the same tx hash; throws RepositoryConflictError if the
   * resolution is already settled with a different hash or the hash belongs to another
   * resolution.
   */
  settleResolution(input: { settlement: SettlementRecord; resolution: CompatibilityResolution }): Promise<ResolutionRecord>;
  getSettlement(txHash: string): Promise<SettlementRecord | undefined>;
  getSettlementForResolution(resolutionId: string): Promise<SettlementRecord | undefined>;

  /** Insert-if-absent by resolutionId; returns the stored voucher (the first one wins). */
  saveVoucher(record: VoucherRecord): Promise<VoucherRecord>;
  getVoucher(resolutionId: string): Promise<VoucherRecord | undefined>;

  /** Insert-if-absent by digest; returns the stored record and whether it was new. */
  saveAdoptionReceipt(record: AdoptionReceiptRecord): Promise<{ record: AdoptionReceiptRecord; created: boolean }>;
  listAdoptionReceipts(resolutionId: string): Promise<AdoptionReceiptRecord[]>;

  getChainCursor(chainId: number, stream: string): Promise<ChainCursor | undefined>;
  setChainCursor(cursor: ChainCursor): Promise<void>;

  /** Liveness probe for /health. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

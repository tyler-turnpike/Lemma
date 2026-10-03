import {
  RepositoryConflictError,
  type AdoptionReceiptRecord,
  type ChainCursor,
  type PreviewRecord,
  type Repository,
  type ResolutionRecord,
  type SettlementRecord,
  type SuccessFeeRecord,
  type VoucherRecord,
} from "./types.js";

const key = (previewId: string, buyer: string) => `${previewId.toLowerCase()}|${buyer.toLowerCase()}`;
const clone = <T>(v: T): T => structuredClone(v);

/** In-memory Repository for tests and local development without Postgres. */
export class MemoryRepository implements Repository {
  private previews = new Map<string, PreviewRecord>();
  private resolutions = new Map<string, ResolutionRecord>();
  private byPreviewBuyer = new Map<string, string>();
  private settlements = new Map<string, SettlementRecord>();
  private vouchers = new Map<string, VoucherRecord>();
  private receipts = new Map<string, AdoptionReceiptRecord>();
  private cursors = new Map<string, ChainCursor>();
  private successFees = new Map<string, SuccessFeeRecord>();
  private delinquent = new Map<string, `0x${string}`>();

  async saveSuccessFee(record: SuccessFeeRecord): Promise<SuccessFeeRecord> {
    const id = record.resolutionId.toLowerCase();
    const existing = this.successFees.get(id);
    if (existing !== undefined) return clone(existing);
    for (const fee of this.successFees.values()) {
      if (fee.txHash.toLowerCase() === record.txHash.toLowerCase()) throw new RepositoryConflictError("success fee tx already recorded");
    }
    this.successFees.set(id, clone(record));
    return clone(record);
  }

  async getSuccessFee(resolutionId: string): Promise<SuccessFeeRecord | undefined> {
    const r = this.successFees.get(resolutionId.toLowerCase());
    return r === undefined ? undefined : clone(r);
  }

  async markDelinquent(input: { buyer: `0x${string}`; resolutionId: `0x${string}`; at: Date }): Promise<void> {
    const k = input.buyer.toLowerCase();
    if (!this.delinquent.has(k)) this.delinquent.set(k, input.resolutionId);
  }

  async isDelinquent(buyer: string): Promise<boolean> {
    return this.delinquent.has(buyer.toLowerCase());
  }

  async savePreview(record: PreviewRecord): Promise<void> {
    const id = record.preview.previewId.toLowerCase();
    if (!this.previews.has(id)) this.previews.set(id, clone(record));
  }

  async getPreview(previewId: string): Promise<PreviewRecord | undefined> {
    const r = this.previews.get(previewId.toLowerCase());
    return r === undefined ? undefined : clone(r);
  }

  async getOrCreatePendingResolution(input: Parameters<Repository["getOrCreatePendingResolution"]>[0]): Promise<ResolutionRecord> {
    const k = key(input.previewId, input.buyer);
    const existing = this.byPreviewBuyer.get(k);
    if (existing !== undefined) return clone(this.resolutions.get(existing) as ResolutionRecord);
    if (this.resolutions.has(input.resolutionId)) throw new RepositoryConflictError("resolution id collision");
    const record: ResolutionRecord = {
      ...input,
      status: "pending",
      paymentHash: null,
      payloadDigest: null,
      resolution: null,
      settledAt: null,
    };
    this.resolutions.set(input.resolutionId, record);
    this.byPreviewBuyer.set(k, input.resolutionId);
    return clone(record);
  }

  async getResolution(resolutionId: string): Promise<ResolutionRecord | undefined> {
    const r = this.resolutions.get(resolutionId.toLowerCase());
    return r === undefined ? undefined : clone(r);
  }

  async getResolutionByPreviewBuyer(previewId: string, buyer: string): Promise<ResolutionRecord | undefined> {
    const id = this.byPreviewBuyer.get(key(previewId, buyer));
    return id === undefined ? undefined : this.getResolution(id);
  }

  async settleResolution(input: { settlement: SettlementRecord; resolution: Parameters<Repository["settleResolution"]>[0]["resolution"] }): Promise<ResolutionRecord> {
    const { settlement, resolution } = input;
    const record = this.resolutions.get(settlement.resolutionId);
    if (record === undefined) throw new RepositoryConflictError("unknown resolution");
    const byHash = this.settlements.get(settlement.txHash);
    if (byHash !== undefined && byHash.resolutionId !== settlement.resolutionId) {
      throw new RepositoryConflictError("settlement transaction already bound to another resolution");
    }
    if (record.status === "settled") {
      if (record.paymentHash !== settlement.txHash) throw new RepositoryConflictError("resolution already settled with a different transaction");
      return clone(record);
    }
    this.settlements.set(settlement.txHash, clone(settlement));
    record.status = "settled";
    record.paymentHash = settlement.txHash;
    record.payloadDigest = resolution.payloadDigest as `0x${string}`;
    record.resolution = clone(resolution);
    record.settledAt = settlement.settledAt;
    return clone(record);
  }

  async getSettlement(txHash: string): Promise<SettlementRecord | undefined> {
    const s = this.settlements.get(txHash.toLowerCase());
    return s === undefined ? undefined : clone(s);
  }

  async getSettlementForResolution(resolutionId: string): Promise<SettlementRecord | undefined> {
    for (const s of this.settlements.values()) if (s.resolutionId === resolutionId.toLowerCase()) return clone(s);
    return undefined;
  }

  async saveVoucher(record: VoucherRecord): Promise<VoucherRecord> {
    const existing = this.vouchers.get(record.resolutionId);
    if (existing !== undefined) return clone(existing);
    this.vouchers.set(record.resolutionId, clone(record));
    return clone(record);
  }

  async getVoucher(resolutionId: string): Promise<VoucherRecord | undefined> {
    const v = this.vouchers.get(resolutionId.toLowerCase());
    return v === undefined ? undefined : clone(v);
  }

  async saveAdoptionReceipt(record: AdoptionReceiptRecord): Promise<{ record: AdoptionReceiptRecord; created: boolean }> {
    const existing = this.receipts.get(record.digest);
    if (existing !== undefined) return { record: clone(existing), created: false };
    this.receipts.set(record.digest, clone(record));
    return { record: clone(record), created: true };
  }

  async listAdoptionReceipts(resolutionId: string): Promise<AdoptionReceiptRecord[]> {
    return [...this.receipts.values()]
      .filter((r) => r.resolutionId === resolutionId.toLowerCase())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }

  async getChainCursor(chainId: number, stream: string): Promise<ChainCursor | undefined> {
    const c = this.cursors.get(`${chainId}|${stream}`);
    return c === undefined ? undefined : clone(c);
  }

  async setChainCursor(cursor: ChainCursor): Promise<void> {
    this.cursors.set(`${cursor.chainId}|${cursor.stream}`, clone(cursor));
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}

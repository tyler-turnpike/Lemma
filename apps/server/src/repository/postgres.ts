import type { CompatibilityResolution, Preview, SignedAdoptionReceipt, SignedResolutionVoucher } from "@lemma/core";
import { and, asc, eq, sql as dsql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as t from "./schema.js";
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

type Hex = `0x${string}`;
type ResolutionRow = typeof t.resolutions.$inferSelect;

function toResolution(row: ResolutionRow): ResolutionRecord {
  return {
    resolutionId: row.resolutionId as Hex,
    previewId: row.previewId as Hex,
    buyer: row.buyer as Hex,
    release: row.release,
    releaseId: row.releaseId as Hex,
    priceAtomic: row.priceAtomic,
    status: row.status === "settled" ? "settled" : "pending",
    paymentHash: row.paymentHash as Hex | null,
    payloadDigest: row.payloadDigest as Hex | null,
    resolution: (row.resolution ?? null) as CompatibilityResolution | null,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
  };
}

function toSettlement(row: typeof t.settlements.$inferSelect): SettlementRecord {
  return {
    txHash: row.txHash as Hex,
    resolutionId: row.resolutionId as Hex,
    network: row.network,
    payer: row.payer as Hex,
    amountAtomic: row.amountAtomic,
    settledAt: row.settledAt,
  };
}

function toReceipt(row: typeof t.adoptionReceipts.$inferSelect): AdoptionReceiptRecord {
  return {
    receiptId: row.receiptId as Hex,
    resolutionId: row.resolutionId as Hex,
    buyer: row.buyer as Hex,
    outcome: row.outcome as AdoptionReceiptRecord["outcome"],
    digest: row.digest as Hex,
    signed: row.signed as SignedAdoptionReceipt,
    createdAt: row.createdAt,
  };
}

/** Postgres Repository (drizzle + postgres-js). All statements are parameterized by drizzle. */
export class PostgresRepository implements Repository {
  private readonly client: postgres.Sql;
  private readonly db: PostgresJsDatabase;

  constructor(databaseUrl: string, options: { max?: number } = {}) {
    this.client = postgres(databaseUrl, { max: options.max ?? 10, onnotice: () => {}, idle_timeout: 30, connect_timeout: 10 });
    this.db = drizzle(this.client);
  }

  async savePreview(record: PreviewRecord): Promise<void> {
    const p = record.preview;
    await this.db
      .insert(t.previews)
      .values({
        previewId: p.previewId,
        decision: p.decision,
        release: p.release,
        releaseId: p.releaseId,
        priceAtomic: p.priceAtomic,
        purchasable: p.purchasable,
        preview: p,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      })
      .onConflictDoNothing({ target: t.previews.previewId });
  }

  async getPreview(previewId: string): Promise<PreviewRecord | undefined> {
    const rows = await this.db.select().from(t.previews).where(eq(t.previews.previewId, previewId.toLowerCase())).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : { preview: row.preview as Preview, expiresAt: row.expiresAt, createdAt: row.createdAt };
  }

  async getOrCreatePendingResolution(input: Parameters<Repository["getOrCreatePendingResolution"]>[0]): Promise<ResolutionRecord> {
    await this.db
      .insert(t.resolutions)
      .values({ ...input, status: "pending" })
      .onConflictDoNothing({ target: [t.resolutions.previewId, t.resolutions.buyer] });
    const found = await this.getResolutionByPreviewBuyer(input.previewId, input.buyer);
    if (found === undefined) throw new RepositoryConflictError("failed to create pending resolution");
    return found;
  }

  async getResolution(resolutionId: string): Promise<ResolutionRecord | undefined> {
    const rows = await this.db.select().from(t.resolutions).where(eq(t.resolutions.resolutionId, resolutionId.toLowerCase())).limit(1);
    return rows[0] === undefined ? undefined : toResolution(rows[0]);
  }

  async getResolutionByPreviewBuyer(previewId: string, buyer: string): Promise<ResolutionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(t.resolutions)
      .where(and(eq(t.resolutions.previewId, previewId.toLowerCase()), eq(t.resolutions.buyer, buyer)))
      .limit(1);
    return rows[0] === undefined ? undefined : toResolution(rows[0]);
  }

  async settleResolution(input: { settlement: SettlementRecord; resolution: CompatibilityResolution }): Promise<ResolutionRecord> {
    const { settlement, resolution } = input;
    return this.db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(t.resolutions)
        .where(eq(t.resolutions.resolutionId, settlement.resolutionId))
        .for("update")
        .limit(1);
      const row = locked[0];
      if (row === undefined) throw new RepositoryConflictError("unknown resolution");
      const byHash = await tx.select().from(t.settlements).where(eq(t.settlements.txHash, settlement.txHash)).limit(1);
      if (byHash[0] !== undefined && byHash[0].resolutionId !== settlement.resolutionId) {
        throw new RepositoryConflictError("settlement transaction already bound to another resolution");
      }
      if (row.status === "settled") {
        if (row.paymentHash !== settlement.txHash) throw new RepositoryConflictError("resolution already settled with a different transaction");
        return toResolution(row);
      }
      await tx.insert(t.settlements).values(settlement);
      const updated = await tx
        .update(t.resolutions)
        .set({
          status: "settled",
          paymentHash: settlement.txHash,
          payloadDigest: resolution.payloadDigest,
          resolution,
          settledAt: settlement.settledAt,
        })
        .where(and(eq(t.resolutions.resolutionId, settlement.resolutionId), eq(t.resolutions.status, "pending")))
        .returning();
      if (updated[0] === undefined) throw new RepositoryConflictError("resolution changed concurrently");
      return toResolution(updated[0]);
    });
  }

  async getSettlement(txHash: string): Promise<SettlementRecord | undefined> {
    const rows = await this.db.select().from(t.settlements).where(eq(t.settlements.txHash, txHash.toLowerCase())).limit(1);
    return rows[0] === undefined ? undefined : toSettlement(rows[0]);
  }

  async getSettlementForResolution(resolutionId: string): Promise<SettlementRecord | undefined> {
    const rows = await this.db.select().from(t.settlements).where(eq(t.settlements.resolutionId, resolutionId.toLowerCase())).limit(1);
    return rows[0] === undefined ? undefined : toSettlement(rows[0]);
  }

  async saveVoucher(record: VoucherRecord): Promise<VoucherRecord> {
    await this.db
      .insert(t.vouchers)
      .values({
        resolutionId: record.resolutionId,
        signer: record.signed.signer,
        signature: record.signed.signature,
        voucher: record.signed,
        createdAt: record.createdAt,
      })
      .onConflictDoNothing({ target: t.vouchers.resolutionId });
    const stored = await this.getVoucher(record.resolutionId);
    if (stored === undefined) throw new RepositoryConflictError("failed to store voucher");
    return stored;
  }

  async getVoucher(resolutionId: string): Promise<VoucherRecord | undefined> {
    const rows = await this.db.select().from(t.vouchers).where(eq(t.vouchers.resolutionId, resolutionId.toLowerCase())).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : { resolutionId: row.resolutionId as Hex, signed: row.voucher as SignedResolutionVoucher, createdAt: row.createdAt };
  }

  async saveSuccessFee(record: SuccessFeeRecord): Promise<SuccessFeeRecord> {
    await this.db
      .insert(t.successFees)
      .values({ ...record, resolutionId: record.resolutionId.toLowerCase(), txHash: record.txHash.toLowerCase() })
      .onConflictDoNothing({ target: t.successFees.resolutionId });
    const stored = await this.getSuccessFee(record.resolutionId);
    if (stored === undefined) throw new RepositoryConflictError("failed to store success fee");
    return stored;
  }

  async getSuccessFee(resolutionId: string): Promise<SuccessFeeRecord | undefined> {
    const rows = await this.db.select().from(t.successFees).where(eq(t.successFees.resolutionId, resolutionId.toLowerCase())).limit(1);
    const row = rows[0];
    return row === undefined
      ? undefined
      : { resolutionId: row.resolutionId as Hex, buyer: row.buyer as Hex, amountAtomic: row.amountAtomic, txHash: row.txHash as Hex, network: row.network, settledAt: row.settledAt };
  }

  async markDelinquent(input: { buyer: `0x${string}`; resolutionId: `0x${string}`; at: Date }): Promise<void> {
    await this.db
      .insert(t.delinquentBuyers)
      .values({ buyer: input.buyer.toLowerCase(), resolutionId: input.resolutionId.toLowerCase(), markedAt: input.at })
      .onConflictDoNothing({ target: t.delinquentBuyers.buyer });
  }

  async isDelinquent(buyer: string): Promise<boolean> {
    const rows = await this.db.select().from(t.delinquentBuyers).where(eq(t.delinquentBuyers.buyer, buyer.toLowerCase())).limit(1);
    return rows.length > 0;
  }

  async saveAdoptionReceipt(record: AdoptionReceiptRecord): Promise<{ record: AdoptionReceiptRecord; created: boolean }> {
    const inserted = await this.db
      .insert(t.adoptionReceipts)
      .values(record)
      .onConflictDoNothing({ target: t.adoptionReceipts.digest })
      .returning();
    if (inserted[0] !== undefined) return { record: toReceipt(inserted[0]), created: true };
    const rows = await this.db.select().from(t.adoptionReceipts).where(eq(t.adoptionReceipts.digest, record.digest)).limit(1);
    if (rows[0] === undefined) throw new RepositoryConflictError("failed to store receipt");
    return { record: toReceipt(rows[0]), created: false };
  }

  async listAdoptionReceipts(resolutionId: string): Promise<AdoptionReceiptRecord[]> {
    const rows = await this.db
      .select()
      .from(t.adoptionReceipts)
      .where(eq(t.adoptionReceipts.resolutionId, resolutionId.toLowerCase()))
      .orderBy(asc(t.adoptionReceipts.createdAt))
      .limit(100);
    return rows.map(toReceipt);
  }

  async getChainCursor(chainId: number, stream: string): Promise<ChainCursor | undefined> {
    const rows = await this.db
      .select()
      .from(t.chainEventCursors)
      .where(and(eq(t.chainEventCursors.chainId, chainId), eq(t.chainEventCursors.stream, stream)))
      .limit(1);
    return rows[0];
  }

  async setChainCursor(cursor: ChainCursor): Promise<void> {
    await this.db
      .insert(t.chainEventCursors)
      .values(cursor)
      .onConflictDoUpdate({
        target: [t.chainEventCursors.chainId, t.chainEventCursors.stream],
        set: { blockNumber: cursor.blockNumber, logIndex: cursor.logIndex, updatedAt: cursor.updatedAt },
      });
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.execute(dsql`select 1`);
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}

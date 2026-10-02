// Drizzle table definitions mirroring migrations/0001_init.sql (the SQL file is the source of truth).
import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const previews = pgTable("previews", {
  previewId: text("preview_id").primaryKey(),
  decision: text("decision").notNull(),
  release: text("release"),
  releaseId: text("release_id"),
  priceAtomic: text("price_atomic"),
  purchasable: boolean("purchasable").notNull(),
  preview: jsonb("preview").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const resolutions = pgTable("resolutions", {
  resolutionId: text("resolution_id").primaryKey(),
  previewId: text("preview_id").notNull(),
  buyer: text("buyer").notNull(),
  release: text("release").notNull(),
  releaseId: text("release_id").notNull(),
  priceAtomic: text("price_atomic").notNull(),
  status: text("status").notNull(),
  paymentHash: text("payment_hash"),
  payloadDigest: text("payload_digest"),
  resolution: jsonb("resolution"),
  createdAt: ts("created_at").notNull(),
  settledAt: ts("settled_at"),
});

export const settlements = pgTable("settlements", {
  txHash: text("tx_hash").primaryKey(),
  resolutionId: text("resolution_id").notNull(),
  network: text("network").notNull(),
  payer: text("payer").notNull(),
  amountAtomic: text("amount_atomic").notNull(),
  settledAt: ts("settled_at").notNull(),
});

export const vouchers = pgTable("vouchers", {
  resolutionId: text("resolution_id").primaryKey(),
  signer: text("signer").notNull(),
  signature: text("signature").notNull(),
  voucher: jsonb("voucher").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const adoptionReceipts = pgTable("adoption_receipts", {
  receiptId: text("receipt_id").primaryKey(),
  resolutionId: text("resolution_id").notNull(),
  buyer: text("buyer").notNull(),
  outcome: text("outcome").notNull(),
  digest: text("digest").notNull(),
  signed: jsonb("signed").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const chainEventCursors = pgTable(
  "chain_event_cursors",
  {
    chainId: integer("chain_id").notNull(),
    stream: text("stream").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    logIndex: integer("log_index").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.stream] })],
);

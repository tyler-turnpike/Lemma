import { join } from "node:path";

import { z } from "zod";

import { BridgeError } from "./errors.js";
import { readJson, writeJsonAtomic } from "./state.js";

const LedgerEntry = z.strictObject({
  previewId: z.string().regex(/^0x[0-9a-f]{64}$/),
  amountAtomic: z.string().regex(/^(0|[1-9][0-9]*)$/),
  /** UTC calendar day (YYYY-MM-DD) the spend counts against. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["authorized", "settled"]),
  authorizedAt: z.string(),
  settledAt: z.string().nullable(),
  paymentHash: z.string().nullable(),
  resolutionId: z.string().nullable(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

const LedgerFile = z.strictObject({ schemaVersion: z.literal("1"), entries: z.array(LedgerEntry) });

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Persistent spend ledger in LEMMA_STATE_DIR. A spend is recorded (as "authorized") before
 * any payment signature is produced and counts against the daily cap from then on, whether
 * or not settlement is ever confirmed. One entry per previewId; recording is idempotent.
 */
export class SpendLedger {
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(stateDir: string) {
    this.file = join(stateDir, "ledger.json");
  }

  private async read(): Promise<LedgerEntry[]> {
    const raw = await readJson(this.file);
    if (raw === null) return [];
    const parsed = LedgerFile.safeParse(raw);
    if (!parsed.success) throw new BridgeError("state", "spend ledger is corrupt; refusing to spend");
    return parsed.data.entries;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async entries(): Promise<LedgerEntry[]> {
    return this.serialize(() => this.read());
  }

  async get(previewId: string): Promise<LedgerEntry | null> {
    return (await this.entries()).find((e) => e.previewId === previewId) ?? null;
  }

  async spentOn(now: Date): Promise<bigint> {
    const day = utcDay(now);
    return (await this.entries()).filter((e) => e.day === day).reduce((sum, e) => sum + BigInt(e.amountAtomic), 0n);
  }

  /** Records an authorization once per previewId. Returns the (possibly pre-existing) entry. */
  async authorize(previewId: string, amountAtomic: bigint, now: Date): Promise<{ entry: LedgerEntry; created: boolean }> {
    return this.serialize(async () => {
      const entries = await this.read();
      const existing = entries.find((e) => e.previewId === previewId);
      if (existing) return { entry: existing, created: false };
      const entry: LedgerEntry = {
        previewId,
        amountAtomic: amountAtomic.toString(),
        day: utcDay(now),
        status: "authorized",
        authorizedAt: now.toISOString(),
        settledAt: null,
        paymentHash: null,
        resolutionId: null,
      };
      await writeJsonAtomic(this.file, { schemaVersion: "1", entries: [...entries, entry] });
      return { entry, created: true };
    });
  }

  /** Marks a spend settled. Creates the entry if the payment predates this ledger (never double counts). */
  async settle(previewId: string, amountAtomic: bigint, paymentHash: string, resolutionId: string, now: Date): Promise<LedgerEntry> {
    return this.serialize(async () => {
      const entries = await this.read();
      const idx = entries.findIndex((e) => e.previewId === previewId);
      const base: LedgerEntry =
        idx >= 0
          ? (entries[idx] as LedgerEntry)
          : {
              previewId,
              amountAtomic: amountAtomic.toString(),
              day: utcDay(now),
              status: "authorized",
              authorizedAt: now.toISOString(),
              settledAt: null,
              paymentHash: null,
              resolutionId: null,
            };
      if (base.status === "settled") return base;
      const entry: LedgerEntry = { ...base, status: "settled", settledAt: now.toISOString(), paymentHash, resolutionId };
      const next = idx >= 0 ? entries.map((e, i) => (i === idx ? entry : e)) : [...entries, entry];
      await writeJsonAtomic(this.file, { schemaVersion: "1", entries: next });
      return entry;
    });
  }
}

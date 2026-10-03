import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CompatibilityResolution,
  Preview,
  RepositoryProfile,
  SignedAdoptionReceipt,
  SignedResolutionVoucher,
  TaskRequest,
} from "@lemma/core";
import { z } from "zod";

import { BridgeError } from "./errors.js";

const ID_RE = /^0x[0-9a-f]{64}$/;

/** Atomically replaces `file` with JSON (write temp in the same dir, fsync via close, rename). */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Reads JSON; null if missing. Corrupt files throw (fail closed). */
export async function readJson(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new BridgeError("state", `cannot read local state file ${file}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BridgeError("state", `local state file ${file} is corrupt; refusing to continue`);
  }
}

export const ActivationRecord = z.strictObject({
  status: z.enum(["activated", "already-active", "skipped", "failed"]),
  txHash: z.string().nullable(),
  blockNumber: z.string().nullable(),
  reason: z.string().nullable(),
  at: z.string(),
});
export type ActivationRecord = z.infer<typeof ActivationRecord>;

export const StoredPreview = z.strictObject({
  preview: Preview,
  task: TaskRequest,
  profile: RepositoryProfile,
  storedAt: z.string(),
});
export type StoredPreview = z.infer<typeof StoredPreview>;

export const StoredResolution = z.strictObject({
  resolution: CompatibilityResolution,
  voucher: SignedResolutionVoucher,
  activation: ActivationRecord.nullable(),
  apply: z
    .strictObject({ filesChanged: z.number().int().nonnegative(), at: z.string() })
    .nullable(),
  receipt: z
    .strictObject({ signed: SignedAdoptionReceipt, submitted: z.boolean(), receiptId: z.string().nullable() })
    .nullable(),
  /** The success fee paid after a passed adoption (absent when the quote had none). */
  successFee: z
    .strictObject({ amountAtomic: z.string().regex(/^[1-9][0-9]{0,30}$/), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).nullable(), at: z.string() })
    .nullable()
    .optional(),
  storedAt: z.string(),
});
export type StoredResolution = z.infer<typeof StoredResolution>;

function checkId(id: string): string {
  if (!ID_RE.test(id)) throw new BridgeError("not-found", "expected a 0x-prefixed lowercase 32-byte id");
  return id;
}

/** Local persistence of previews, verified resolutions, vouchers, activations and receipts. */
export class StateStore {
  constructor(readonly dir: string) {}

  private previewFile(previewId: string) {
    return join(this.dir, "previews", `${checkId(previewId)}.json`);
  }
  private resolutionFile(resolutionId: string) {
    return join(this.dir, "resolutions", `${checkId(resolutionId)}.json`);
  }
  private purchaseIndexFile(previewId: string) {
    return join(this.dir, "purchases", `${checkId(previewId)}.json`);
  }

  async savePreview(record: StoredPreview): Promise<void> {
    await writeJsonAtomic(this.previewFile(record.preview.previewId), StoredPreview.parse(record));
  }

  async loadPreview(previewId: string): Promise<StoredPreview | null> {
    const raw = await readJson(this.previewFile(previewId));
    if (raw === null) return null;
    const parsed = StoredPreview.safeParse(raw);
    if (!parsed.success) throw new BridgeError("state", "stored preview is invalid");
    return parsed.data;
  }

  async saveResolution(record: StoredResolution): Promise<void> {
    const parsed = StoredResolution.parse(record);
    await writeJsonAtomic(this.resolutionFile(parsed.resolution.resolutionId), parsed);
    await writeJsonAtomic(this.purchaseIndexFile(parsed.resolution.previewId), { resolutionId: parsed.resolution.resolutionId });
  }

  async loadResolution(resolutionId: string): Promise<StoredResolution | null> {
    const raw = await readJson(this.resolutionFile(resolutionId));
    if (raw === null) return null;
    const parsed = StoredResolution.safeParse(raw);
    if (!parsed.success) throw new BridgeError("state", "stored resolution is invalid");
    return parsed.data;
  }

  async loadResolutionByPreview(previewId: string): Promise<StoredResolution | null> {
    const raw = await readJson(this.purchaseIndexFile(previewId));
    if (raw === null) return null;
    const id = (raw as { resolutionId?: unknown }).resolutionId;
    if (typeof id !== "string") throw new BridgeError("state", "purchase index is invalid");
    return this.loadResolution(id);
  }

  /** Keeps a payload that failed verification, for dispute evidence. Never applied. */
  async quarantine(previewId: string, payload: unknown, reasons: readonly string[]): Promise<string> {
    const file = join(this.dir, "quarantine", `${checkId(previewId)}-${Date.now()}.json`);
    await writeJsonAtomic(file, { previewId, reasons, payload });
    return file;
  }
}

import { digest, sha256Hex } from "./canonical.js";
import { AdoptionReceipt, PatchBundle, type AdoptionReceipt as AdoptionReceiptT, type PatchBundle as PatchBundleT } from "./schemas.js";
import type { Hex } from "viem";

/** Environment-neutral base64 (no Buffer, so the module stays browser-safe). */
export function decodeBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Canonical keccak digest of a bundle; this is the `payloadDigest` bound into vouchers. */
export function bundleDigest(bundle: PatchBundleT): Hex {
  return digest(PatchBundle.parse(bundle));
}

/**
 * Validates schema and that each op's content hashes to its declared newSha256 and is
 * UTF-8 text without NUL bytes. Returns a list of problems (empty when valid).
 */
export function verifyBundleIntegrity(bundle: unknown): string[] {
  const parsed = PatchBundle.safeParse(bundle);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const problems: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const op of parsed.data.operations) {
    const bytes = decodeBase64(op.contentBase64);
    if (sha256Hex(bytes) !== op.newSha256) problems.push(`${op.path}: content does not match newSha256`);
    if (bytes.includes(0)) problems.push(`${op.path}: binary content is not allowed`);
    try {
      decoder.decode(bytes);
    } catch {
      problems.push(`${op.path}: content is not valid UTF-8`);
    }
  }
  return problems;
}

/** 32-byte digest the buyer signs (EIP-191) for an Adoption Receipt. */
export function adoptionReceiptDigest(receipt: AdoptionReceiptT): Hex {
  return digest(AdoptionReceipt.parse(receipt));
}

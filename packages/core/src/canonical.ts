import { canonicalize } from "json-canonicalize";
import { bytesToHex, keccak256, sha256 as viemSha256, stringToBytes, type Hex } from "viem";

/**
 * RFC 8785 (JCS) canonical JSON. Rejects values that JSON cannot represent
 * faithfully (bigint, undefined at top level, non-finite numbers, functions).
 */
export function canonicalJson(value: unknown): string {
  assertJsonSafe(value, "$");
  return canonicalize(value);
}

/** keccak256 of the canonical UTF-8 JSON bytes. */
export function digest(value: unknown): Hex {
  return keccak256(stringToBytes(canonicalJson(value)));
}

/** keccak256 of a UTF-8 string. */
export function keccakString(value: string): Hex {
  return keccak256(stringToBytes(value));
}

/** keccak256 of raw bytes. */
export function keccakBytes(bytes: Uint8Array): Hex {
  return keccak256(bytes);
}

/** Release identifier: keccak256("name@version"). */
export function releaseIdFor(nameAtVersion: string): Hex {
  if (!/^[a-z0-9][a-z0-9-]{0,63}@[0-9A-Za-z.+-]{1,64}$/.test(nameAtVersion)) {
    throw new Error(`invalid release reference: ${JSON.stringify(nameAtVersion)}`);
  }
  return keccakString(nameAtVersion);
}

/** High-entropy 32-byte resolution identifier (0x-prefixed lowercase hex). */
export function newResolutionId(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** Bare lowercase sha256 hex (no 0x) of raw bytes, used for file contents. */
export function sha256Hex(bytes: Uint8Array): string {
  return viemSha256(bytes).slice(2);
}

function assertJsonSafe(value: unknown, path: string, seen = new Set<object>()): void {
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
      return;
    case "object": {
      if (value === null) return;
      if (seen.has(value)) throw new TypeError(`cycle at ${path}`);
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item, i) => assertJsonSafe(item, `${path}[${i}]`, seen));
      } else {
        const proto: unknown = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
          throw new TypeError(`non-plain object at ${path}`);
        }
        for (const [k, v] of Object.entries(value)) {
          if (v === undefined) throw new TypeError(`undefined value at ${path}.${k}`);
          assertJsonSafe(v, `${path}.${k}`, seen);
        }
      }
      seen.delete(value);
      return;
    }
    default:
      throw new TypeError(`unsupported ${typeof value} at ${path}`);
  }
}

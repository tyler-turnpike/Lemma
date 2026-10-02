/** Secret scrubbing for logs, errors, receipts and benchmark records. */

export const REDACTED = "[REDACTED]";

const HEX_KEY_RE = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SECRET_FIELD_RE = /(private[_-]?key|secret|password|passphrase|mnemonic|api[_-]?key|authorization|access[_-]?token|refresh[_-]?token)/i;
const SECRET_ENV_NAME_RE = /(KEY|SECRET|TOKEN|PASSWORD|PRIVATE|MNEMONIC|DATABASE_URL|CREDENTIAL)/i;

export type RedactOptions = {
  /** Literal secret values (e.g. env var values) to scrub wherever they appear. */
  knownSecrets?: readonly string[];
  /**
   * Public 32-byte hex values (tx hashes, digests) that may be kept. Every other
   * 0x+64-hex token is treated as a potential private key.
   */
  allowHex?: readonly string[];
};

/** Collect values of secret-looking env vars (min length 8) for use as `knownSecrets`. */
export function secretsFromEnv(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && value.length >= 8 && SECRET_ENV_NAME_RE.test(name)) out.push(value);
  }
  return out;
}

export function redactString(input: string, options: RedactOptions = {}): string {
  let out = input;
  const known = [...(options.knownSecrets ?? [])].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length);
  for (const secret of known) out = out.split(secret).join(REDACTED);
  const allow = new Set((options.allowHex ?? []).map((h) => h.toLowerCase()));
  out = out.replace(HEX_KEY_RE, (m) => (allow.has(m.toLowerCase()) ? m : `0x${REDACTED}`));
  out = out.replace(BEARER_RE, (_m, word: string) => `${word} ${REDACTED}`);
  return out;
}

/** Deep-redacts strings inside arrays and plain objects; secret-named fields are fully replaced. */
export function redact<T>(value: T, options: RedactOptions = {}): T {
  return redactInner(value, options, new WeakMap()) as T;
}

function redactInner(value: unknown, options: RedactOptions, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") return redactString(value, options);
  if (value instanceof Error) {
    const copy = new Error(redactString(value.message, options));
    copy.name = value.name;
    if (value.stack !== undefined) copy.stack = redactString(value.stack, options);
    return copy;
  }
  if (value === null || typeof value !== "object") return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached;
  if (Array.isArray(value)) {
    const arr: unknown[] = [];
    seen.set(value, arr);
    for (const item of value) arr.push(redactInner(item, options, seen));
    return arr;
  }
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_FIELD_RE.test(k) && v !== null && v !== undefined && v !== "" ? REDACTED : redactInner(v, options, seen);
  }
  return out;
}

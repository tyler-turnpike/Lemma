import { redact, redactString } from "@lemma/core";

export type Logger = {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
};

/**
 * JSON line logger that scrubs known secret values, secret-named fields and any
 * 32-byte hex token not explicitly allowlisted (tx hashes and digests are passed as
 * `allowHex` by callers that need them visible).
 */
export function createLogger(options: { secrets: readonly string[]; silent?: boolean; allowHex?: () => readonly string[] }): Logger {
  // Also scrub the bare-hex form of 0x-prefixed secrets.
  const secrets = [...new Set(options.secrets.flatMap((s) => (/^0x[0-9a-fA-F]{16,}$/.test(s) ? [s, s.slice(2)] : [s])))];
  const write = (level: string, msg: string, fields: Record<string, unknown> | undefined) => {
    if (options.silent === true) return;
    // `publicHex` lists public 32-byte values (tx hashes, ids) that must stay readable.
    const { publicHex, ...rest } = fields ?? {};
    const allow = [...(options.allowHex?.() ?? []), ...(Array.isArray(publicHex) ? publicHex.filter((h): h is string => typeof h === "string") : [])];
    const opts = { knownSecrets: secrets, allowHex: allow };
    const safeFields = redact(serializeErrors(rest), opts);
    const line = JSON.stringify({ level, time: new Date().toISOString(), msg: redactString(msg, opts), ...safeFields });
    if (level === "error") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
  };
}

function serializeErrors(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message } : v;
  }
  return out;
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

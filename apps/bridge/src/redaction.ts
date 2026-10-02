import { redact, redactString } from "@lemma/core";

const HEX32_RE = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;

export type Scrubber = {
  string(input: string): string;
  value<T>(input: T): T;
};

/**
 * Scrubs known secret values (buyer key, RPC URL, env secrets) everywhere. Public
 * 32-byte hex values (digests, ids, tx hashes) are kept unless they equal a secret.
 */
export function createScrubber(secrets: readonly string[]): Scrubber {
  const expanded = new Set<string>();
  for (const s of secrets) {
    if (s.length < 8) continue;
    expanded.add(s);
    expanded.add(s.toLowerCase());
    expanded.add(s.toUpperCase());
    if (/^0x[0-9a-fA-F]+$/.test(s)) {
      expanded.add(s.slice(2));
      expanded.add(s.slice(2).toLowerCase());
      expanded.add(s.slice(2).toUpperCase());
    }
  }
  const knownSecrets = [...expanded];
  const secretHex = new Set(knownSecrets.filter((s) => /^0x[0-9a-fA-F]{64}$/.test(s)).map((s) => s.toLowerCase()));
  const publicHexIn = (strings: string[]): string[] => {
    const out = new Set<string>();
    for (const str of strings) for (const m of str.match(HEX32_RE) ?? []) if (!secretHex.has(m.toLowerCase())) out.add(m);
    return [...out];
  };
  return {
    string(input: string): string {
      return redactString(input, { knownSecrets, allowHex: publicHexIn([input]) });
    },
    value<T>(input: T): T {
      return redact(input, { knownSecrets, allowHex: publicHexIn(collectStrings(input)) });
    },
  };
}

function collectStrings(value: unknown, out: string[] = [], seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") out.push(value);
  else if (value instanceof Error) out.push(value.message, value.stack ?? "");
  else if (value !== null && typeof value === "object") {
    if (seen.has(value)) return out;
    seen.add(value);
    for (const v of Array.isArray(value) ? value : Object.values(value)) collectStrings(v, out, seen);
  }
  return out;
}

export type Logger = {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
};

/** Logs to stderr only (stdout carries the MCP stdio protocol). Everything is scrubbed. */
export function createLogger(scrub: Scrubber, sink: (line: string) => void = (l) => process.stderr.write(l)): Logger {
  const write = (level: string, message: string, data?: unknown) => {
    let suffix = "";
    if (data !== undefined) {
      try {
        suffix = ` ${JSON.stringify(scrub.value(data instanceof Error ? { error: data.message } : data), (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`;
      } catch {
        suffix = " [unserializable]";
      }
    }
    sink(scrub.string(`[lemma-mcp] ${level} ${message}${suffix}\n`));
  };
  return {
    info: (m, d) => write("info", m, d),
    warn: (m, d) => write("warn", m, d),
    error: (m, d) => write("error", m, d),
  };
}

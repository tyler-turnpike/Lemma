import { existsSync, readFileSync } from "node:fs";

import { redact, secretsFromEnv } from "@lemma/core";

/**
 * Parses a dotenv file into a plain object WITHOUT touching process.env, so secrets never
 * reach child processes by inheritance. Supports KEY=value, optional quotes, and # comments.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m === null) continue;
    let value = m[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    out[m[1]!] = value.trim();
  }
  return out;
}

export function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnvFile(readFileSync(path, "utf8"));
}

/** Benchmark env: the .env file overlaid by explicitly exported process variables. Never written back to process.env. */
export function benchmarkEnv(envFilePath: string): Record<string, string> {
  const fromFile = loadEnvFile(envFilePath);
  const merged: Record<string, string> = { ...fromFile };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== "") merged[k] = v;
  return merged;
}

/** Every literal that must never be persisted: secret-named env values plus explicitly listed ones. */
export function knownSecrets(env: Record<string, string | undefined>, extra: readonly string[] = []): string[] {
  return [...new Set([...secretsFromEnv(env), ...extra.filter((s) => s.length >= 8)])];
}

/**
 * Redacts a value for persistence and then fails closed if any known secret still appears
 * in its serialized form. `allowHex` lists public 32-byte values (tx hashes, digests) to keep.
 */
export function scrubForPersistence<T>(value: T, secrets: readonly string[], allowHex: readonly string[] = []): T {
  const out = redact(value, { knownSecrets: secrets, allowHex });
  const serialized = JSON.stringify(out);
  for (const s of secrets) {
    if (s.length >= 8 && serialized.includes(s)) throw new Error("refusing to persist a record that still contains a known secret");
  }
  return out;
}

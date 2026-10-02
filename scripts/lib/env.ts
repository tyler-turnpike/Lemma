/**
 * Environment loading for the operator scripts. Secrets are read programmatically from a
 * dotenv file and never printed: every narrated line goes through `Scrubber`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PUBLIC_ARBITRUM_SEPOLIA_RPC = "https://sepolia-rollup.arbitrum.io/rpc";

export type Env = Record<string, string | undefined>;

/** Minimal dotenv parser (KEY=VALUE, optional quotes, # comments). Never logs values. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m === null) continue;
    let value = m[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    out[m[1] as string] = value.trim();
  }
  return out;
}

/**
 * Loads `file` (default <repo>/.env) underneath `process.env`: explicitly exported variables
 * win over the file. Returns a merged copy; `process.env` itself is not modified.
 */
export function loadEnv(file: string | null = join(REPO_ROOT, ".env")): Env {
  const fromFile = file !== null && existsSync(file) ? parseDotEnv(readFileSync(file, "utf8")) : {};
  const merged: Env = { ...fromFile };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== "") merged[k] = v;
  return merged;
}

export function optional(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v === undefined || v === "" ? undefined : v;
}

export function required(env: Env, name: string): string {
  const v = optional(env, name);
  if (v === undefined) throw new Error(`${name} is not set`);
  return v;
}

export type Role = { name: string; account: PrivateKeyAccount; privateKey: Hex; address: Address };

/** Loads a role key and checks it against its declared public address (when one is set). */
export function roleFromEnv(env: Env, name: string, keyVar: string, addressVar?: string): Role {
  const key = required(env, keyVar);
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${keyVar} is not a 0x-prefixed 32-byte hex key`);
  const account = privateKeyToAccount(key as Hex);
  const declared = addressVar === undefined ? undefined : optional(env, addressVar);
  if (declared !== undefined && getAddress(declared) !== account.address) {
    throw new Error(`${addressVar} does not match ${keyVar} (key derives ${account.address})`);
  }
  return { name, account, privateKey: key as Hex, address: account.address };
}

/** Scrubs literal secret values (keys, API keys, passwords, DB/RPC URLs) from text. */
export class Scrubber {
  private readonly secrets: string[] = [];

  add(...values: Array<string | undefined>): this {
    for (const v of values) {
      if (v === undefined || v.length < 8) continue;
      this.secrets.push(v);
      if (/^0x[0-9a-fA-F]{64}$/.test(v)) this.secrets.push(v.slice(2), v.toLowerCase(), v.slice(2).toLowerCase());
    }
    this.secrets.sort((a, b) => b.length - a.length);
    return this;
  }

  /** Adds every value whose variable name looks secret-bearing. */
  addFromEnv(env: Env): this {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) continue;
      if (/PRIVATE_KEY|API_KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(k)) this.add(v);
      // RPC URLs commonly embed provider API keys; the public endpoint is not secret.
      if (/RPC_URL$/.test(k) && v !== PUBLIC_ARBITRUM_SEPOLIA_RPC && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(v)) this.add(v);
    }
    return this;
  }

  scrub(text: string): string {
    let out = text;
    for (const s of this.secrets) out = out.split(s).join("[REDACTED]");
    return out;
  }
}

/**
 * Non-secret process settings children need to reach the network the same way this process
 * does: proxy variables, extra CA bundles (TLS-intercepting proxies) and Node flags. Spawned
 * servers, bridges and CLIs get these plus their explicit role variables, nothing else.
 */
const NETWORK_ENV = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "NODE_USE_ENV_PROXY",
  "NODE_OPTIONS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

export function childEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of NETWORK_ENV) {
    const v = process.env[k];
    if (v !== undefined && v !== "") out[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) out[k] = v;
  return out;
}

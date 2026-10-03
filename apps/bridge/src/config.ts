import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { ARBITRUM_SEPOLIA, parseUsdc, secretsFromEnv } from "@lemma/core";
import type { Address, Hex } from "viem";
import { z } from "zod";

import { BridgeError } from "./errors.js";

const empty = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const AddressEnv = z.preprocess(empty, z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional());
const UsdcEnv = (def: string) =>
  z.preprocess(
    empty,
    z
      .string()
      .default(def)
      .refine((v) => {
        try {
          parseUsdc(v);
          return true;
        } catch {
          return false;
        }
      }, "expected a decimal USDC amount such as 0.25"),
  );

const EnvSchema = z.object({
  LEMMA_API_URL: z.preprocess(empty, z.string().default("http://localhost:3000").pipe(z.url({ protocol: /^https?$/ }))),
  LEMMA_WORKSPACE: z.preprocess(empty, z.string().optional()),
  CLAUDE_PROJECT_DIR: z.preprocess(empty, z.string().optional()),
  LEMMA_HOME: z.preprocess(empty, z.string().optional()),
  ARBITRUM_SEPOLIA_RPC_URL: z.preprocess(empty, z.url({ protocol: /^https?$/ }).optional()),
  BUYER_PRIVATE_KEY: z.preprocess(empty, z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional()),
  LEMMA_MAX_USDC_PER_RESOLUTION: UsdcEnv("0.25"),
  LEMMA_DAILY_USDC_CAP: UsdcEnv("1.00"),
  USDC_ADDRESS: z.preprocess(empty, z.string().regex(/^0x[0-9a-fA-F]{40}$/).default(ARBITRUM_SEPOLIA.usdc)),
  RESOLUTION_WARRANTY_REGISTRY_ADDRESS: AddressEnv,
  LEMMA_PROVIDER_ADDRESS: AddressEnv,
  LEMMA_STATE_DIR: z.preprocess(empty, z.string().optional()),
});

/** Public (non-secret) bridge configuration. The buyer key is held separately. */
export type BridgeConfig = {
  apiUrl: string;
  mcpUrl: string;
  /** Best static guess; the bridge resolves (and validates) the effective workspace lazily. */
  workspace: string;
  /** Where `workspace` came from. "cwd" means MCP client roots may still override it. */
  workspaceSource: "LEMMA_WORKSPACE" | "CLAUDE_PROJECT_DIR" | "cwd";
  rpcUrl: string | null;
  perResolutionCapAtomic: bigint;
  dailyCapAtomic: bigint;
  usdcAddress: Address;
  registryAddress: Address | null;
  providerAddress: Address | null;
  stateDir: string;
  network: typeof ARBITRUM_SEPOLIA.caip2;
  chainId: typeof ARBITRUM_SEPOLIA.chainId;
};

export type LoadedConfig = {
  config: BridgeConfig;
  /** Never logged, returned, or sent anywhere; only used to build the local signer. */
  buyerPrivateKey: Hex | null;
  /** Literal values to scrub from every outbound message and log line. */
  secrets: string[];
};

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export function loadConfig(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): LoadedConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Name the variables only; never echo their values.
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "?")))];
    throw new BridgeError("config", `invalid bridge configuration in ${names.join(", ")}`);
  }
  const e = parsed.data;
  const apiUrl = e.LEMMA_API_URL.replace(/\/+$/, "");
  const workspaceSource = e.LEMMA_WORKSPACE !== undefined ? "LEMMA_WORKSPACE" : e.CLAUDE_PROJECT_DIR !== undefined ? "CLAUDE_PROJECT_DIR" : "cwd";
  const workspace = resolve(cwd, expandHome(e.LEMMA_WORKSPACE ?? e.CLAUDE_PROJECT_DIR ?? cwd));
  const stateDirRaw = expandHome(e.LEMMA_STATE_DIR ?? e.LEMMA_HOME ?? "~/.lemma");
  const stateDir = isAbsolute(stateDirRaw) ? stateDirRaw : resolve(cwd, stateDirRaw);
  const secrets = secretsFromEnv(env);
  if (e.BUYER_PRIVATE_KEY !== undefined) secrets.push(e.BUYER_PRIVATE_KEY);
  // RPC URLs commonly embed API keys.
  if (e.ARBITRUM_SEPOLIA_RPC_URL !== undefined) secrets.push(e.ARBITRUM_SEPOLIA_RPC_URL);
  return {
    config: {
      apiUrl,
      mcpUrl: `${apiUrl}/mcp`,
      workspace,
      workspaceSource,
      rpcUrl: e.ARBITRUM_SEPOLIA_RPC_URL ?? null,
      perResolutionCapAtomic: parseUsdc(e.LEMMA_MAX_USDC_PER_RESOLUTION),
      dailyCapAtomic: parseUsdc(e.LEMMA_DAILY_USDC_CAP),
      usdcAddress: e.USDC_ADDRESS as Address,
      registryAddress: (e.RESOLUTION_WARRANTY_REGISTRY_ADDRESS as Address | undefined) ?? null,
      providerAddress: (e.LEMMA_PROVIDER_ADDRESS as Address | undefined) ?? null,
      stateDir,
      network: ARBITRUM_SEPOLIA.caip2,
      chainId: ARBITRUM_SEPOLIA.chainId,
    },
    buyerPrivateKey: (e.BUYER_PRIVATE_KEY as Hex | undefined) ?? null,
    secrets,
  };
}

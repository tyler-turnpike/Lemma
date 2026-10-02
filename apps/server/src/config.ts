import { ARBITRUM_SEPOLIA, secretsFromEnv } from "@lemma/core";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

/** A signing role: public address plus the private key that must derive to it. */
export type RoleKey = { address: Address; privateKey: Hex };

export type ServerConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  publicBaseUrl: string;
  databaseUrl: string | undefined;
  rpcUrl: string | undefined;
  chainId: number;
  network: `eip155:${number}`;
  usdc: Address;
  registry: Address | undefined;
  provider: { address: Address | undefined; key: RoleKey | undefined };
  facilitator: { address: Address | undefined; key: RoleKey | undefined };
  evaluator: Address | undefined;
  allowProvisional: boolean;
  /** Trust the first X-Forwarded-For hop for rate limiting (set behind Railway's proxy). */
  trustProxy: boolean;
  /** Literal secret values to scrub from any log line. */
  secrets: string[];
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());

const AddressString = z.string().refine((v) => isAddress(v, { strict: false }), "expected a 20-byte hex address");
const PrivateKeyString = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hex private key");
const BoolString = z.enum(["true", "false"]);

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(["development", "test", "production"]).default("development")),
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65_535).default(3000)),
  PUBLIC_BASE_URL: z.preprocess(emptyToUndefined, z.url({ protocol: /^https?$/ }).default("http://localhost:3000")),
  DATABASE_URL: opt(z.string().regex(/^postgres(ql)?:\/\//, "expected a postgres:// URL")),
  ARBITRUM_SEPOLIA_RPC_URL: opt(z.url({ protocol: /^(https?|wss?)$/ })),
  ARBITRUM_SEPOLIA_CHAIN_ID: opt(z.coerce.number().int()),
  USDC_ADDRESS: opt(AddressString),
  RESOLUTION_WARRANTY_REGISTRY_ADDRESS: opt(AddressString),
  PROVIDER_ADDRESS: opt(AddressString),
  PROVIDER_PRIVATE_KEY: opt(PrivateKeyString),
  FACILITATOR_ADDRESS: opt(AddressString),
  FACILITATOR_PRIVATE_KEY: opt(PrivateKeyString),
  EVALUATOR_ADDRESS: opt(AddressString),
  LEMMA_ALLOW_PROVISIONAL: z.preprocess(emptyToUndefined, BoolString.default("false")),
  LEMMA_TRUST_PROXY: z.preprocess(emptyToUndefined, BoolString.default("false")),
});

function roleFrom(name: string, address: string | undefined, privateKey: string | undefined): { address: Address | undefined; key: RoleKey | undefined } {
  const declared = address === undefined ? undefined : getAddress(address);
  if (privateKey === undefined) return { address: declared, key: undefined };
  const derived = privateKeyToAccount(privateKey as Hex).address;
  if (declared !== undefined && declared !== derived) {
    // Never echo the key; the derived address is public.
    throw new ConfigError(`${name}_ADDRESS does not match ${name}_PRIVATE_KEY (key derives ${derived})`);
  }
  return { address: derived, key: { address: derived, privateKey: privateKey as Hex } };
}

/**
 * Loads and validates server configuration. Fails closed on malformed values and on
 * address/key mismatches. Missing payment roles do not fail: paid tools are disabled
 * while previews and read APIs keep working.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Issue paths name the variable; messages never include the offending value.
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`invalid environment: ${detail}`);
  }
  const e = parsed.data;
  const chainId = e.ARBITRUM_SEPOLIA_CHAIN_ID ?? ARBITRUM_SEPOLIA.chainId;
  if (chainId !== ARBITRUM_SEPOLIA.chainId) throw new ConfigError(`ARBITRUM_SEPOLIA_CHAIN_ID must be ${ARBITRUM_SEPOLIA.chainId}`);
  const usdc = getAddress(e.USDC_ADDRESS ?? ARBITRUM_SEPOLIA.usdc);
  if (usdc !== getAddress(ARBITRUM_SEPOLIA.usdc)) throw new ConfigError(`USDC_ADDRESS must be Arbitrum Sepolia USDC ${ARBITRUM_SEPOLIA.usdc}`);

  const provider = roleFrom("PROVIDER", e.PROVIDER_ADDRESS, e.PROVIDER_PRIVATE_KEY);
  const facilitator = roleFrom("FACILITATOR", e.FACILITATOR_ADDRESS, e.FACILITATOR_PRIVATE_KEY);
  if (provider.key !== undefined && facilitator.key !== undefined && provider.key.address === facilitator.key.address) {
    throw new ConfigError("provider and facilitator must be distinct keys");
  }
  if (e.NODE_ENV === "production" && e.DATABASE_URL === undefined) throw new ConfigError("DATABASE_URL is required in production");

  const secrets = [...secretsFromEnv(env)];
  for (const k of [provider.key?.privateKey, facilitator.key?.privateKey]) if (k !== undefined) secrets.push(k, k.slice(2));

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/+$/, ""),
    databaseUrl: e.DATABASE_URL,
    rpcUrl: e.ARBITRUM_SEPOLIA_RPC_URL,
    chainId,
    network: `eip155:${chainId}`,
    usdc,
    registry: e.RESOLUTION_WARRANTY_REGISTRY_ADDRESS === undefined ? undefined : getAddress(e.RESOLUTION_WARRANTY_REGISTRY_ADDRESS),
    provider,
    facilitator,
    evaluator: e.EVALUATOR_ADDRESS === undefined ? undefined : getAddress(e.EVALUATOR_ADDRESS),
    allowProvisional: e.LEMMA_ALLOW_PROVISIONAL === "true",
    trustProxy: e.LEMMA_TRUST_PROXY === "true",
    secrets,
  };
}

/** Why paid tools are unavailable, or null when the provider side is fully configured. */
export function paidDisabledReason(config: ServerConfig, hasFacilitator: boolean): string | null {
  const missing: string[] = [];
  if (config.provider.key === undefined) missing.push("PROVIDER_PRIVATE_KEY");
  if (config.registry === undefined) missing.push("RESOLUTION_WARRANTY_REGISTRY_ADDRESS");
  if (!hasFacilitator) missing.push("FACILITATOR_PRIVATE_KEY and ARBITRUM_SEPOLIA_RPC_URL");
  return missing.length === 0 ? null : `paid tools are disabled: missing ${missing.join(", ")}`;
}

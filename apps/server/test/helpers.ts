import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createx402MCPClient } from "@x402/mcp";
import type { Hono } from "hono";
import { bytesToHex, getAddress, verifyTypedData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { loadConfig, type ServerConfig } from "../src/config.js";

export const REGISTRY = getAddress("0x5FbDB2315678afecb367f032d93F642f64180aa3");
export const NETWORK = "eip155:421614" as const;

export type Keys = { provider: PrivateKeyAccount; providerKey: Hex; facilitatorKey: Hex; buyerKey: Hex; buyer: PrivateKeyAccount };

export function makeKeys(): Keys {
  const providerKey = generatePrivateKey();
  const buyerKey = generatePrivateKey();
  return {
    providerKey,
    provider: privateKeyToAccount(providerKey),
    facilitatorKey: generatePrivateKey(),
    buyerKey,
    buyer: privateKeyToAccount(buyerKey),
  };
}

export function makeConfig(keys: Keys | null, extra: Record<string, string> = {}): ServerConfig {
  const env: Record<string, string> = {
    NODE_ENV: "test",
    PUBLIC_BASE_URL: "https://lemma.example",
    LEMMA_ALLOW_PROVISIONAL: "true",
    EVALUATOR_ADDRESS: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  };
  if (keys !== null) {
    env.PROVIDER_PRIVATE_KEY = keys.providerKey;
    env.PROVIDER_ADDRESS = keys.provider.address;
    env.RESOLUTION_WARRANTY_REGISTRY_ADDRESS = REGISTRY;
  }
  return loadConfig({ ...env, ...extra });
}

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Fake facilitator: really verifies the buyer's EIP-3009 signature, recipient and amount
 * offline, and "settles" by returning a random transaction hash. Records every call.
 */
export class FakeFacilitator implements FacilitatorClient {
  verifyCalls: Array<{ payload: PaymentPayload; requirements: PaymentRequirements }> = [];
  settleCalls: Array<{ payload: PaymentPayload; requirements: PaymentRequirements; tx: Hex }> = [];
  failSettle = false;

  async getSupported(): Promise<SupportedResponse> {
    return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [], signers: { "eip155:*": ["0x0000000000000000000000000000000000000001"] } };
  }

  private async check(payload: PaymentPayload, requirements: PaymentRequirements): Promise<string | null> {
    const p = payload.payload as { signature?: Hex; authorization?: { from: Hex; to: Hex; value: string; validAfter: string; validBefore: string; nonce: Hex } };
    const a = p.authorization;
    if (a === undefined || p.signature === undefined) return "missing authorization";
    if (getAddress(a.to) !== getAddress(requirements.payTo)) return "wrong recipient";
    if (a.value !== requirements.amount) return "wrong amount";
    const ok = await verifyTypedData({
      address: a.from,
      domain: { name: String(requirements.extra.name), version: String(requirements.extra.version), chainId: 421614, verifyingContract: requirements.asset as Hex },
      types: EIP3009_TYPES,
      primaryType: "TransferWithAuthorization",
      message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
      signature: p.signature,
    });
    return ok ? null : "bad signature";
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    this.verifyCalls.push({ payload, requirements });
    const problem = await this.check(payload, requirements);
    const from = (payload.payload as { authorization?: { from?: string } }).authorization?.from;
    return problem === null ? { isValid: true, ...(from === undefined ? {} : { payer: from }) } : { isValid: false, invalidReason: problem };
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const tx = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    this.settleCalls.push({ payload, requirements, tx });
    if (this.failSettle) return { success: false, errorReason: "simulated_failure", transaction: "", network: requirements.network };
    const from = (payload.payload as { authorization?: { from?: string } }).authorization?.from;
    return { success: true, transaction: tx, network: requirements.network, ...(from === undefined ? {} : { payer: from }) };
  }
}

/** fetch that routes to the in-process Hono app (real Streamable HTTP framing, no socket). */
export function appFetch(app: Hono): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
}

export const MCP_URL = new URL("https://lemma.example/mcp");

export async function connectMcp(app: Hono): Promise<Client> {
  const client = new Client({ name: "lemma-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(MCP_URL, { fetch: appFetch(app) }));
  return client;
}

export async function connectPayingMcp(app: Hono, buyer: PrivateKeyAccount, onPaymentRequested?: (amount: string) => void) {
  const client = createx402MCPClient({
    name: "lemma-test-buyer",
    version: "0.0.0",
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(buyer) }],
    autoPayment: true,
    onPaymentRequested: ({ paymentRequired }) => {
      onPaymentRequested?.(paymentRequired.accepts[0]?.amount ?? "");
      return true;
    },
  });
  await client.connect(new StreamableHTTPClientTransport(MCP_URL, { fetch: appFetch(app) }));
  return client;
}

/** Parses the JSON text block of a tool result. */
export function toolJson(result: { content?: unknown }): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  const first = content?.[0];
  if (first?.type !== "text" || first.text === undefined) throw new Error("expected a text content block");
  return JSON.parse(first.text) as Record<string, unknown>;
}

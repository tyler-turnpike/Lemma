// Acceptance test shipped by Lemma capability release x402-mcp-server@1.0.0.
// Runs fully offline: an in-process facilitator stands in for the HTTP facilitator.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { x402Client } from "@x402/core/client";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { x402MCPClient } from "@x402/mcp";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { ARBITRUM_SEPOLIA, ARBITRUM_SEPOLIA_USDC, createX402Paywall } from "../src/lemma/x402-paywall.js";
import { createServer } from "../src/server.js";

const PAY_TO = "0x1111111111111111111111111111111111111111" as const;

class InProcessFacilitator implements FacilitatorClient {
  verified: PaymentRequirements[] = [];
  settled: PaymentRequirements[] = [];
  constructor(private readonly accept = true) {}
  async getSupported(): Promise<SupportedResponse> {
    return { kinds: [{ x402Version: 2, scheme: "exact", network: ARBITRUM_SEPOLIA }], extensions: [], signers: {} };
  }
  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    this.verified.push(requirements);
    const auth = (payload.payload as { authorization?: { from?: string } }).authorization;
    return this.accept ? { isValid: true, payer: auth?.from ?? "0x0" } : { isValid: false, invalidReason: "invalid_signature" };
  }
  async settle(_payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    this.settled.push(requirements);
    return { success: true, transaction: `0x${"ab".repeat(32)}`, network: requirements.network };
  }
}

async function connect(facilitator: InProcessFacilitator, autoPayment: boolean) {
  const server = createServer(createX402Paywall({ facilitator, payTo: PAY_TO, priceAtomic: "10000" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const payments = new x402Client().register(ARBITRUM_SEPOLIA, new ExactEvmScheme(privateKeyToAccount(generatePrivateKey())));
  const client = new x402MCPClient(new Client({ name: "acceptance", version: "1.0.0" }), payments, { autoPayment });
  await client.connect(clientTransport);
  return client;
}

describe("x402 paywall on the MCP server", () => {
  it("advertises Arbitrum Sepolia USDC payment requirements for the paid tool", async () => {
    const client = await connect(new InProcessFacilitator(), false);
    const required = await client.getToolPaymentRequirements("get_forecast", { city: "Lisbon" });
    expect(required).not.toBeNull();
    const accept = required?.accepts[0];
    expect(accept?.network).toBe("eip155:421614");
    expect(accept?.asset.toLowerCase()).toBe(ARBITRUM_SEPOLIA_USDC.toLowerCase());
    expect(accept?.amount).toBe("10000");
    expect(accept?.payTo.toLowerCase()).toBe(PAY_TO);
    await client.close();
  });

  it("runs the tool and settles exactly once after a verified payment", async () => {
    const facilitator = new InProcessFacilitator();
    const client = await connect(facilitator, true);
    const result = await client.callTool("get_forecast", { city: "Lisbon" });
    expect(result.paymentMade).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Forecast for Lisbon");
    expect(facilitator.settled).toHaveLength(1);
    expect(facilitator.settled[0]?.amount).toBe("10000");
    await client.close();
  });

  it("does not run the tool when the payment fails verification", async () => {
    const facilitator = new InProcessFacilitator(false);
    const client = await connect(facilitator, true);
    const outcome = await client.callTool("get_forecast", { city: "Lisbon" }).then(
      (r) => JSON.stringify(r.content),
      (e: unknown) => String(e),
    );
    expect(outcome).not.toContain("Forecast for Lisbon");
    expect(facilitator.settled).toHaveLength(0);
    await client.close();
  });

  it("keeps free tools free", async () => {
    const client = await connect(new InProcessFacilitator(), true);
    const result = await client.callTool("ping", {});
    expect(result.paymentMade).toBe(false);
    expect(JSON.stringify(result.content)).toContain("pong");
    await client.close();
  });
});

// Acceptance test shipped by Lemma capability release x402-mcp-client@1.0.0.
// Runs fully offline against an in-process paid MCP server and facilitator.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { Network, PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createPaymentWrapper } from "@x402/mcp";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { connectPayingAgent } from "../src/agent.js";

const NETWORK: Network = "eip155:421614";
const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const PROVIDER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";

class InProcessFacilitator implements FacilitatorClient {
  settled: string[] = [];
  async getSupported(): Promise<SupportedResponse> {
    return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [], signers: {} };
  }
  async verify(payload: PaymentPayload): Promise<VerifyResponse> {
    const auth = (payload.payload as { authorization?: { from?: string } }).authorization;
    return { isValid: true, payer: auth?.from ?? "0x0" };
  }
  async settle(_payload: PaymentPayload, req: PaymentRequirements): Promise<SettleResponse> {
    this.settled.push(req.amount);
    return { success: true, transaction: `0x${"cd".repeat(32)}`, network: req.network };
  }
}

async function paidServer(facilitator: FacilitatorClient, tools: Array<{ name: string; amount: string; payTo: string; asset?: string }>) {
  const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());
  await resourceServer.initialize();
  const server = new McpServer({ name: "paid-research", version: "1.0.0" });
  for (const tool of tools) {
    const accepts = await resourceServer.buildPaymentRequirements({
      scheme: "exact",
      network: NETWORK,
      payTo: tool.payTo,
      price: { asset: tool.asset ?? USDC, amount: tool.amount, extra: { name: "USD Coin", version: "2" } },
      maxTimeoutSeconds: 300,
    });
    const paid = createPaymentWrapper(resourceServer, { accepts });
    // Paid tools must declare an inputSchema: the MCP SDK passes (args, extra) only then.
    server.registerTool(tool.name, { description: `costs ${tool.amount}`, inputSchema: { topic: z.string().optional() } }, paid(async () => ({ content: [{ type: "text" as const, text: `result:${tool.name}` }] })));
  }
  server.registerTool("free", { description: "free" }, async () => ({ content: [{ type: "text", text: "result:free" }] }));
  return server;
}

async function setup(tools: Parameters<typeof paidServer>[1]) {
  const facilitator = new InProcessFacilitator();
  const server = await paidServer(facilitator, tools);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const agent = await connectPayingAgent(clientTransport, privateKeyToAccount(generatePrivateKey()), {
    maxPerCallAtomic: 100_000n,
    maxTotalAtomic: 120_000n,
    allowedPayTo: [PROVIDER],
  });
  return { agent, facilitator };
}

describe("x402-paying MCP client with hard spend limits", () => {
  it("pays within limits and enforces the total budget", async () => {
    const { agent, facilitator } = await setup([{ name: "report", amount: "50000", payTo: PROVIDER }]);
    const first = await agent.callTool("report");
    expect(first.paymentMade).toBe(true);
    expect(JSON.stringify(first.content)).toContain("result:report");
    await agent.callTool("report");
    expect(agent.spentAtomic()).toBe(100_000n);
    await expect(agent.callTool("report")).rejects.toThrow();
    expect(agent.spentAtomic()).toBe(100_000n);
    expect(facilitator.settled).toEqual(["50000", "50000"]);
    await agent.close();
  });

  it("refuses payments above the per-call cap", async () => {
    const { agent, facilitator } = await setup([{ name: "expensive", amount: "100001", payTo: PROVIDER }]);
    await expect(agent.callTool("expensive")).rejects.toThrow();
    expect(agent.spentAtomic()).toBe(0n);
    expect(facilitator.settled).toEqual([]);
    await agent.close();
  });

  it("refuses unknown recipients and non-USDC assets", async () => {
    const { agent, facilitator } = await setup([
      { name: "redirected", amount: "1000", payTo: STRANGER },
      { name: "othertoken", amount: "1000", payTo: PROVIDER, asset: "0x4444444444444444444444444444444444444444" },
    ]);
    await expect(agent.callTool("redirected")).rejects.toThrow();
    await expect(agent.callTool("othertoken")).rejects.toThrow();
    expect(agent.spentAtomic()).toBe(0n);
    expect(facilitator.settled).toEqual([]);
    await agent.close();
  });

  it("calls free tools without paying", async () => {
    const { agent } = await setup([]);
    const result = await agent.callTool("free");
    expect(result.paymentMade).toBe(false);
    expect(JSON.stringify(result.content)).toContain("result:free");
    await agent.close();
  });
});

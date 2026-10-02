import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ClientEvmSigner } from "@x402/evm";

import { createPayingMcpClient, type SpendLimits } from "./lemma/x402-paying-client.js";

/** Connects the research agent to an MCP server and exposes a minimal tool-calling surface. */
export async function connectAgent(transport: Transport) {
  const client = new Client({ name: "research-agent", version: "0.1.0" });
  await client.connect(transport);
  return {
    async callTool(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      return { content: result.content };
    },
    close: () => client.close(),
  };
}

/** Same surface as connectAgent, but pays x402-protected tools within hard spend limits. */
export async function connectPayingAgent(transport: Transport, signer: ClientEvmSigner, limits: SpendLimits) {
  const { client, ledger } = createPayingMcpClient({ signer, limits, name: "research-agent", version: "0.1.0" });
  await client.connect(transport);
  return {
    async callTool(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool(name, args);
      return { content: result.content, paymentMade: result.paymentMade };
    },
    spentAtomic: () => ledger.spentAtomic,
    close: () => client.close(),
  };
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createX402PaywallFromEnv, type X402Paywall } from "./lemma/x402-paywall.js";

export function createServer(paywall: X402Paywall = createX402PaywallFromEnv()): McpServer {
  const server = new McpServer({ name: "weather-demo", version: "0.1.0" });

  server.registerTool(
    "get_forecast",
    {
      description: "Premium three-day forecast for a city. Requires an x402 payment (USDC on Arbitrum Sepolia).",
      inputSchema: { city: z.string().min(1).max(80) },
    },
    paywall.paid(async ({ city }: { city: string }) => ({
      content: [{ type: "text" as const, text: `Forecast for ${city}: sunny, 24C.` }],
    })),
  );

  server.registerTool(
    "ping",
    { description: "Health check." },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );

  return server;
}

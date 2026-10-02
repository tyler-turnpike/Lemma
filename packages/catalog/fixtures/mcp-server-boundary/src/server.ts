import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function createServer(): McpServer {
  const server = new McpServer({ name: "weather-demo", version: "0.1.0" });

  server.registerTool(
    "get_forecast",
    {
      description: "Premium three-day forecast for a city.",
      inputSchema: { city: z.string().min(1).max(80) },
    },
    async ({ city }) => ({
      content: [{ type: "text", text: `Forecast for ${city}: sunny, 24C.` }],
    }),
  );

  server.registerTool(
    "ping",
    { description: "Health check." },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );

  return server;
}

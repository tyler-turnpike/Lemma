#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { assembleBridge } from "./bridge.js";
import { errorMessage } from "./errors.js";

async function main(): Promise<void> {
  const { server, config, buyerAddress, log } = assembleBridge();
  if (config.registryAddress === null) log.warn("RESOLUTION_WARRANTY_REGISTRY_ADDRESS is not set; warranties will not be activated on chain");
  if (config.providerAddress === null) log.warn("LEMMA_PROVIDER_ADDRESS is not set; purchases are disabled");
  if (buyerAddress === null) log.warn("BUYER_PRIVATE_KEY is not set; purchases and receipts are disabled");
  await server.connect(new StdioServerTransport());
  log.info("lemma-mcp ready", { api: config.mcpUrl, workspace: config.workspace, buyer: buyerAddress });
}

main().catch((error: unknown) => {
  // Config errors never contain secret values; still avoid printing raw objects.
  process.stderr.write(`[lemma-mcp] fatal: ${errorMessage(error).replace(/0x[0-9a-fA-F]{64}/g, "0x[REDACTED]")}\n`);
  process.exit(1);
});

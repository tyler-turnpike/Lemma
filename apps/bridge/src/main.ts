import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { assembleBridge, type AssembleOptions } from "./bridge.js";
import { errorMessage } from "./errors.js";
import { assertUsableWorkspace } from "./workspace.js";

/** Assembles the bridge and serves it over stdio. Shared by the `dist/index.js` bin and the bundled CLI. */
export async function startStdioBridge(options: AssembleOptions = {}): Promise<void> {
  const { server, config, buyerAddress, log } = assembleBridge(options);
  if (config.registryAddress === null) log.warn("RESOLUTION_WARRANTY_REGISTRY_ADDRESS is not set; warranties will not be activated on chain");
  if (config.providerAddress === null) log.warn("LEMMA_PROVIDER_ADDRESS is not set; purchases are disabled");
  if (buyerAddress === null) log.warn("BUYER_PRIVATE_KEY is not set; purchases and receipts are disabled");
  try {
    assertUsableWorkspace(config.workspace);
  } catch (error) {
    // Not fatal: a roots-capable client may still name the workspace on first use.
    log.warn(`${errorMessage(error)} (unless the MCP client provides roots)`);
  }
  await server.connect(new StdioServerTransport());
  log.info("lemma-mcp ready", { api: config.mcpUrl, workspace: config.workspace, buyer: buyerAddress });
}

/** Runs `start`, printing a scrubbed one-line fatal error to stderr and exiting 1 on failure. */
export function runOrExit(start: () => Promise<void>): void {
  start().catch((error: unknown) => {
    // Config errors never contain secret values; still avoid printing raw objects.
    process.stderr.write(`[lemma-mcp] fatal: ${errorMessage(error).replace(/0x[0-9a-fA-F]{64}/g, "0x[REDACTED]")}\n`);
    process.exit(1);
  });
}

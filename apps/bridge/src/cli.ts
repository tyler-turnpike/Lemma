#!/usr/bin/env node
/**
 * Entry of the bundled, zero-config `lemma-mcp` package (`npx -y <url>/lemma-mcp-0.1.0.tgz`).
 * Defaults point at the hosted Lemma deployment on Arbitrum Sepolia; any env var overrides them.
 * Without BUYER_PRIVATE_KEY a local burner wallet is created in LEMMA_HOME (~/.lemma).
 */
import { expandHome } from "./config.js";
import { runOrExit, startStdioBridge } from "./main.js";
import { loadOrCreateBurnerWallet } from "./wallet.js";

/** Production deployment. The provider address is pinned here and never fetched. */
export const PRODUCTION_DEFAULTS = {
  LEMMA_API_URL: "https://lemma-production-8383.up.railway.app",
  LEMMA_PROVIDER_ADDRESS: "0xA9361c7A43b65933EAFdCEf63CfC07449C38AcB1",
  RESOLUTION_WARRANTY_REGISTRY_ADDRESS: "0x45Ae8799dF4C0878AD22CFe7040383F25f046d56",
  ARBITRUM_SEPOLIA_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc",
  USDC_ADDRESS: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
} as const;

const unset = (v: string | undefined) => v === undefined || v.trim() === "";

runOrExit(async () => {
  const env = process.env;
  for (const [name, value] of Object.entries(PRODUCTION_DEFAULTS)) if (unset(env[name])) env[name] = value;
  if (!unset(env["BUYER_PRIVATE_KEY"])) return startStdioBridge();
  const burner = loadOrCreateBurnerWallet(expandHome(env["LEMMA_HOME"]?.trim() || "~/.lemma"));
  if (burner.created) {
    // stderr only: stdout carries the MCP protocol. The key is never printed.
    process.stderr.write(`[lemma-mcp] created burner wallet ${burner.address} (${burner.file}); call lemma_wallet for funding links\n`);
  }
  return startStdioBridge({ burner });
});

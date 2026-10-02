#!/usr/bin/env node
// Starts the lemma-mcp bridge for a benchmark treatment run.
//
// Codex passes MCP server settings on its command line (--config), so secrets cannot go there.
// Instead the harness writes BUYER_PRIVATE_KEY (and the RPC URL) to a 0600 file inside a 0700
// harness directory that the agent's sandbox is denied from reading. This launcher reads that
// file, sets the values on its own process.env at runtime (so they never appear in any argv or
// in /proc/<pid>/environ), and then loads the bridge in-process. Nothing is printed: stdout
// carries MCP traffic.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const secretsFile = process.env.LEMMA_BENCH_SECRETS_FILE;
const entry = process.env.LEMMA_BENCH_BRIDGE_ENTRY;
if (!entry) {
  process.stderr.write("[bench-launcher] LEMMA_BENCH_BRIDGE_ENTRY is not set\n");
  process.exit(1);
}
if (secretsFile) {
  const secrets = JSON.parse(readFileSync(secretsFile, "utf8"));
  for (const [name, value] of Object.entries(secrets)) {
    if (typeof value === "string" && value !== "") process.env[name] = value;
  }
}
delete process.env.LEMMA_BENCH_SECRETS_FILE;
await import(pathToFileURL(entry).href);

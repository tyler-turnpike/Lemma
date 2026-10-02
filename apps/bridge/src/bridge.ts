import { privateKeyToAccount } from "viem/accounts";

import { ViemWarrantyActivator } from "./chain.js";
import { loadConfig, type LoadedConfig } from "./config.js";
import { SpendLedger } from "./ledger.js";
import { Bridge } from "./operations.js";
import { createLogger, createScrubber, type Logger, type Scrubber } from "./redaction.js";
import { McpRemoteLemma, httpTransportFactory, type TransportFactory } from "./remote.js";
import { createBridgeServer } from "./server.js";
import { StateStore } from "./state.js";

export const BRIDGE_COMPONENT = { name: "@lemma/bridge", status: "implemented" } as const;

export type AssembleOptions = {
  env?: Record<string, string | undefined>;
  cwd?: string;
  transportFactory?: TransportFactory;
  logSink?: (line: string) => void;
};

/** Wires config, wallet, remote client, ledger, store and the MCP server together. */
export function assembleBridge(options: AssembleOptions = {}) {
  const env = options.env ?? process.env;
  const loaded: LoadedConfig = loadConfig(env, options.cwd);
  const scrub: Scrubber = createScrubber(loaded.secrets);
  const log: Logger = createLogger(scrub, options.logSink);
  const buyer = loaded.buyerPrivateKey === null ? null : privateKeyToAccount(loaded.buyerPrivateKey);
  const { config } = loaded;
  const remote = new McpRemoteLemma(options.transportFactory ?? httpTransportFactory(config.mcpUrl), buyer, config);
  const bridge = new Bridge({
    config,
    buyer,
    remote,
    ledger: new SpendLedger(config.stateDir),
    store: new StateStore(config.stateDir),
    activator: buyer === null ? null : new ViemWarrantyActivator(buyer, config.registryAddress, config.rpcUrl),
    log,
    acceptanceEnv: env as NodeJS.ProcessEnv,
  });
  const server = createBridgeServer(bridge, scrub, log);
  return { config, buyerAddress: buyer?.address ?? null, bridge, server, scrub, log };
}

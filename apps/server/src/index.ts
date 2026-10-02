// Entry point: `node apps/server/dist/index.js` starts the long-lived HTTP server.
// Importing this module (e.g. from tests) does not start anything.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createLogger } from "./log.js";
import { MemoryRepository } from "./repository/memory.js";
import { runMigrations } from "./repository/migrate.js";
import { PostgresRepository } from "./repository/postgres.js";
import type { Repository } from "./repository/types.js";

export { SERVER_COMPONENT } from "./component.js";
export { createApp, type AppDeps, type AppHandle } from "./app.js";
export { loadConfig, type ServerConfig } from "./config.js";
export { MemoryRepository } from "./repository/memory.js";
export { PostgresRepository } from "./repository/postgres.js";
export type { Repository } from "./repository/types.js";

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    process.stderr.write(`${error instanceof ConfigError ? error.message : "invalid configuration"}\n`);
    process.exit(1);
  }
  const logger = createLogger({ secrets: config.secrets });

  let repo: Repository;
  if (config.databaseUrl !== undefined) {
    if (env.LEMMA_MIGRATE_ON_START !== "false") {
      const applied = await runMigrations(config.databaseUrl);
      if (applied.length > 0) logger.info("applied migrations", { applied });
    }
    repo = new PostgresRepository(config.databaseUrl);
  } else {
    logger.warn("DATABASE_URL not set: using in-memory storage (development only; data is lost on restart)");
    repo = new MemoryRepository();
  }

  const { app, paidDisabledReason } = createApp({ config, repo, logger });
  const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
    logger.info("lemma server listening", { port: info.port, paidTools: paidDisabledReason === null ? "enabled" : "disabled" });
  });

  // Bound slow clients; a paid call can legitimately wait for onchain confirmation.
  const http = server as unknown as { requestTimeout: number; headersTimeout: number; keepAliveTimeout: number };
  http.requestTimeout = 120_000;
  http.headersTimeout = 20_000;
  http.keepAliveTimeout = 65_000;

  const shutdown = (signal: string) => {
    logger.info("shutting down", { signal });
    server.close(() => {
      void repo.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((error: unknown) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.name : "error"}\n`);
    process.exit(1);
  });
}

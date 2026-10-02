// `npm run migrate -w @lemma/server`: applies apps/server/migrations to DATABASE_URL.
import { redactString, secretsFromEnv } from "@lemma/core";

import { runMigrations } from "../repository/migrate.js";

const url = process.env.DATABASE_URL;
if (url === undefined || url.trim() === "") {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}
try {
  const applied = await runMigrations(url);
  process.stdout.write(applied.length === 0 ? "schema is up to date\n" : `applied: ${applied.join(", ")}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`migration failed: ${redactString(message, { knownSecrets: secretsFromEnv(process.env) })}\n`);
  process.exit(1);
}

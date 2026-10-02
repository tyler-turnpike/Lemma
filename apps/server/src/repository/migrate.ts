import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

/** apps/server/migrations, resolved from either src/ (tests, tsx) or dist/ (compiled). */
export function defaultMigrationsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
}

const MIGRATION_FILE_RE = /^[0-9]{4}_[a-z0-9_]+\.sql$/;
// Arbitrary constant key so concurrent migrators serialize.
const LOCK_KEY = 0x4c454d4d41;

/**
 * Applies pending SQL migrations in lexical order, each in its own transaction, recording
 * versions in schema_migrations. Holds a session advisory lock so two processes never
 * migrate concurrently. Returns the versions applied by this call.
 */
export async function runMigrations(databaseUrl: string, dir: string = defaultMigrationsDir()): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => MIGRATION_FILE_RE.test(f)).sort();
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  const applied: string[] = [];
  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    try {
      await sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
      const done = new Set((await sql<{ version: string }[]>`select version from schema_migrations`).map((r) => r.version));
      for (const file of files) {
        const version = file.replace(/\.sql$/, "");
        if (done.has(version)) continue;
        const body = readFileSync(join(dir, file), "utf8");
        await sql.begin(async (tx) => {
          // Trusted, version-controlled DDL; never interpolated with request data.
          await tx.unsafe(body);
          await tx`insert into schema_migrations (version) values (${version})`;
        });
        applied.push(version);
      }
    } finally {
      await sql`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  return applied;
}

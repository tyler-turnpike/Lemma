import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** packages/benchmark, resolved from either src/ (tests, tsx) or dist/ (compiled). */
export function benchmarkRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function repoRoot(): string {
  return resolve(benchmarkRoot(), "..", "..");
}

/** Raw run records. Git-ignored (see .gitignore: packages/benchmark/runs/*). */
export function runsDir(): string {
  return join(benchmarkRoot(), "runs");
}

/** Scrubbed aggregate served by apps/server at GET /api/v1/benchmarks. Git-ignored until a real run. */
export function publishedAggregatePath(): string {
  return join(benchmarkRoot(), "published", "aggregate.json");
}

export function bridgeEntrypoint(): string {
  return join(repoRoot(), "apps", "bridge", "dist", "index.js");
}

/**
 * Parent of per-run harness dirs (CODEX_HOME, bridge secrets file). Kept out of the system temp dir
 * because Codex refuses to install its helper binaries under a temporary CODEX_HOME. Git-ignored.
 */
export function harnessParent(): string {
  return join(runsDir(), ".harness");
}

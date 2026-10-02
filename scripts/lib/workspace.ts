/** Temporary buyer workspaces copied from catalog fixtures (resolving the repo's installed deps). */
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCatalog } from "@lemma/catalog";

import { REPO_ROOT } from "./env.js";

export function fixtureWorkspace(fixtureId: string, parent: string = tmpdir()): string {
  const catalog = loadCatalog();
  const dir = mkdtempSync(join(parent, `ws-${fixtureId}-`));
  cpSync(catalog.fixtureDir(fixtureId), dir, { recursive: true });
  // Fixtures run against the dependencies installed at the repository root.
  symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}

/**
 * Prepared failure for the warranty demo: the exact fixture plus a team test harness that stubs
 * `@x402/mcp` in every test file. The repository profile (package.json) still matches exactly,
 * so Lemma sells the resolution, but the pinned acceptance recipe fails in this workspace.
 * This is a deliberately staged incompatibility, labelled as such in the demo output.
 */
export function preparedFailureWorkspace(parent: string = tmpdir()): string {
  const dir = fixtureWorkspace("mcp-server-exact", parent);
  mkdirSync(join(dir, "test"), { recursive: true });
  writeFileSync(
    join(dir, "vitest.config.ts"),
    `import { defineConfig } from "vitest/config";\n\n// Team harness: every unit test runs with network SDKs stubbed.\nexport default defineConfig({ test: { setupFiles: ["./test/team-harness.setup.ts"] } });\n`,
  );
  writeFileSync(
    join(dir, "test", "team-harness.setup.ts"),
    `// PREPARED FAILURE (Lemma demo): stubs the payment SDK the resolution depends on.\nimport { vi } from "vitest";\n\nvi.mock("@x402/mcp", () => ({}));\n`,
  );
  return dir;
}

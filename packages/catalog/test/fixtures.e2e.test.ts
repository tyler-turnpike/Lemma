import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PatchBundle } from "@lemma/core";
import { applyBundle, runAcceptance } from "@lemma/core/node";
import { afterAll, describe, expect, it } from "vitest";

import { loadCatalog } from "../src/index.js";

const catalog = loadCatalog();
const repoNodeModules = join(catalog.root, "..", "..", "node_modules");
const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Copies a fixture into an isolated temp workspace that resolves the repo's installed dependencies. */
function workspace(fixtureId: string): string {
  const dir = mkdtempSync(join(tmpdir(), `lemma-${fixtureId}-`));
  temps.push(dir);
  cpSync(catalog.fixtureDir(fixtureId), dir, { recursive: true });
  symlinkSync(repoNodeModules, join(dir, "node_modules"), "dir");
  return dir;
}

const runnable = catalog.listFixtures().filter((f) => f.acceptance === "pass-after-patch");

describe("release bundles against positive fixtures", () => {
  it("covers an exact and a boundary fixture per release", () => {
    for (const r of catalog.listReleases()) {
      const roles = runnable.filter((f) => f.release === r.id).map((f) => f.role);
      expect(roles).toEqual(expect.arrayContaining(["exact", "boundary"]));
    }
  });

  for (const fixture of runnable) {
    const release = catalog.getRelease(fixture.release)!;

    it(`${fixture.id}: acceptance fails before the patch`, async () => {
      const dir = workspace(fixture.id);
      // Install only the release's acceptance test so we observe the unpatched behaviour.
      const testsOnly: PatchBundle = {
        ...release.bundle,
        operations: release.bundle.operations.filter((op) => op.path.startsWith("test/")),
        dependencyAdditions: { dependencies: {}, devDependencies: {} },
      };
      expect(testsOnly.operations.length).toBeGreaterThan(0);
      await applyBundle(dir, testsOnly, { dryRun: false });
      const run = await runAcceptance(dir, release.manifest.acceptance);
      expect(run.passed, run.steps.map((s) => s.output).join("\n")).toBe(false);
    }, 60_000);

    it(`${fixture.id}: bundle applies atomically and acceptance passes`, async () => {
      const dir = workspace(fixture.id);
      const preview = await applyBundle(dir, release.bundle);
      expect(preview.dryRun).toBe(true);
      const applied = await applyBundle(dir, release.bundle, { dryRun: false });
      expect(applied.filesChanged).toBe(release.bundle.operations.length + 1);
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      expect(pkg.dependencies["@x402/mcp"]).toBe("2.27.0");
      const run = await runAcceptance(dir, release.manifest.acceptance);
      expect(run.passed, run.steps.map((s) => s.output).join("\n")).toBe(true);
      expect(run.steps[0]?.output).toMatch(/Tests\s+4 passed/);
    }, 60_000);
  }

  it("refuses to apply onto a drifted workspace", async () => {
    const dir = workspace("mcp-server-commonjs");
    const release = catalog.getRelease("x402-mcp-server@1.0.0")!;
    // Same server.ts, so apply is allowed byte-wise; drift appears once the file is edited.
    cpSync(join(catalog.fixtureDir("mcp-server-exact"), "src", "index.ts"), join(dir, "src", "server.ts"));
    await expect(applyBundle(dir, release.bundle, { dryRun: false })).rejects.toMatchObject({ code: "drift" });
  });
});

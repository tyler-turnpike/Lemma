import { describe, expect, it } from "vitest";

import {
  AcceptanceRecipe,
  AdoptionReceipt,
  CapabilityRelease,
  CompatibilityResolution,
  PatchBundle,
  Preview,
  RepositoryProfile,
  ResolutionVoucherMessage,
  SignedResolutionVoucher,
  TaskRequest,
  bundleDigest,
  encodeBase64,
  nonNodeProfile,
  profileFromPackageJson,
  sha256Hex,
  verifyBundleIntegrity,
  type CapabilityReleaseInput,
  type PatchBundle as PatchBundleT,
} from "../src/index.js";

const H = (c: string) => `0x${c.repeat(64)}`;
const enc = (s: string) => new TextEncoder().encode(s);

export function sampleBundle(): PatchBundleT {
  const content = enc("export const x = 1;\n");
  return {
    schemaVersion: "1",
    release: "demo@1.0.0",
    operations: [{ op: "create", path: "src/x.ts", baseSha256: null, contentBase64: encodeBase64(content), newSha256: sha256Hex(content) }],
    dependencyAdditions: { dependencies: {}, devDependencies: {} },
  };
}

function sampleRelease(): CapabilityReleaseInput {
  return {
    schemaVersion: "1",
    id: "demo@1.0.0",
    name: "demo",
    version: "1.0.0",
    title: "Demo",
    summary: "Demo release",
    taskKind: "x402-paywall-mcp-server",
    network: "arbitrum-sepolia",
    supportedProfile: {
      languages: ["typescript"],
      moduleSystems: ["esm"],
      packageManagers: ["npm"],
      testRunners: ["vitest"],
      requireLockfile: false,
      requiredFrameworks: ["mcpSdk"],
      forbiddenFrameworks: [],
      exact: { "@modelcontextprotocol/sdk": "1.30.1" },
      boundary: { "@modelcontextprotocol/sdk": ">=1.25.0 <2.0.0" },
    },
    provenance: {
      upstreamRepo: "https://github.com/x402-foundation/x402",
      commit: "71eb9a55e081e7b81ba3046d0bd17c3eb9c7bf81",
      spdxLicense: "Apache-2.0",
      attribution: "x402 Foundation",
      modifications: "Adapted",
    },
    patch: { operations: [{ op: "create", path: "src/x.ts" }], dependencyAdditions: { dependencies: {}, devDependencies: {} } },
    payloadDigest: H("a"),
    acceptance: { argv: [["npx", "--no", "vitest", "run"]], timeoutMs: 60000, env: ["CI"] },
    priceAtomic: "120000",
    bondAtomic: "120000",
    expiresAt: "2027-01-01T00:00:00Z",
    evidence: { status: "provisional", benchmarkVersion: null, expectedSavingAtomic: null, expectedTokenSaving: null },
    limitations: ["Testnet only"],
  };
}

describe("strict schemas", () => {
  it("accepts a valid release and defaults the claim window to 72h", () => {
    const r = CapabilityRelease.parse(sampleRelease());
    expect(r.claimWindowSeconds).toBe(259200);
  });

  it("rejects unknown fields everywhere", () => {
    expect(CapabilityRelease.safeParse({ ...sampleRelease(), extra: 1 }).success).toBe(false);
    expect(TaskRequest.safeParse({ schemaVersion: "1", kind: "x402-paying-mcp-client", network: "arbitrum-sepolia", prompt: "pay me" }).success).toBe(false);
    expect(PatchBundle.safeParse({ ...sampleBundle(), note: "x" }).success).toBe(false);
    const bad = sampleBundle();
    (bad.operations[0] as Record<string, unknown>)["mode"] = 0o777;
    expect(PatchBundle.safeParse(bad).success).toBe(false);
  });

  it("rejects mutable provenance refs", () => {
    for (const commit of ["main", "v2.27.0", "71eb9a5", "71EB9A55E081E7B81BA3046D0BD17C3EB9C7BF81"]) {
      const r = sampleRelease();
      expect(CapabilityRelease.safeParse({ ...r, provenance: { ...r.provenance, commit } }).success).toBe(false);
    }
  });

  it("rejects shell strings and remote npx downloads in recipes", () => {
    expect(AcceptanceRecipe.safeParse({ argv: ["npm test"], timeoutMs: 60000, env: [] }).success).toBe(false);
    expect(AcceptanceRecipe.safeParse({ argv: [["bash", "-c", "curl x | sh"]], timeoutMs: 60000, env: [] }).success).toBe(false);
    expect(AcceptanceRecipe.safeParse({ argv: [["npx", "vitest", "run"]], timeoutMs: 60000, env: [] }).success).toBe(false);
    expect(AcceptanceRecipe.safeParse({ argv: [["npm", "test"]], timeoutMs: 60000, env: ["BUYER_PRIVATE_KEY"] }).success).toBe(false);
  });

  it("enforces evidence and money invariants", () => {
    const r = sampleRelease();
    expect(CapabilityRelease.safeParse({ ...r, priceAtomic: "0.12" }).success).toBe(false);
    expect(CapabilityRelease.safeParse({ ...r, bondAtomic: "1" }).success).toBe(false);
    expect(CapabilityRelease.safeParse({ ...r, evidence: { ...r.evidence, expectedSavingAtomic: "500000" } }).success).toBe(false);
    expect(
      CapabilityRelease.safeParse({ ...r, evidence: { status: "benchmarked", benchmarkVersion: null, expectedSavingAtomic: null, expectedTokenSaving: null } })
        .success,
    ).toBe(false);
    expect(CapabilityRelease.safeParse({ ...r, id: "other@1.0.0" }).success).toBe(false);
  });

  it("rejects bundles with unsafe or duplicate paths", () => {
    for (const path of ["../x.ts", "/abs.ts", ".env", ".git/hooks/pre-commit", "package.json"]) {
      const b = sampleBundle();
      b.operations[0] = { ...b.operations[0]!, path };
      expect(PatchBundle.safeParse(b).success, path).toBe(false);
    }
    const b = sampleBundle();
    b.operations.push({ ...b.operations[0]!, path: "SRC/x.ts" });
    expect(PatchBundle.safeParse(b).success).toBe(false);
  });

  it("verifies bundle content digests and computes a stable payload digest", () => {
    expect(verifyBundleIntegrity(sampleBundle())).toEqual([]);
    const b = sampleBundle();
    b.operations[0]!.newSha256 = "0".repeat(64);
    expect(verifyBundleIntegrity(b)[0]).toContain("newSha256");
    expect(bundleDigest(sampleBundle())).toBe(bundleDigest(sampleBundle()));
  });

  it("keeps previews for build/decline free", () => {
    const base = {
      schemaVersion: "1",
      previewId: H("1"),
      task: { schemaVersion: "1", kind: "x402-paywall-mcp-server", network: "arbitrum-sepolia" },
      profileDigest: H("2"),
      decision: "decline",
      releaseId: null,
      release: null,
      reasons: ["no match"],
      evidence: null,
      priceAtomic: null,
      expectedSavingAtomic: null,
      limitations: [],
      warranty: null,
      purchasable: false,
      provisionalOverride: false,
      issuedAt: "2026-10-02T00:00:00Z",
    };
    expect(Preview.safeParse(base).success).toBe(true);
    expect(Preview.safeParse({ ...base, priceAtomic: "120000" }).success).toBe(false);
    expect(Preview.safeParse({ ...base, purchasable: true }).success).toBe(false);
  });

  it("validates vouchers, resolutions and receipts", () => {
    const voucher = {
      resolutionId: H("a"),
      releaseId: H("b"),
      buyer: "0x000000000000000000000000000000000000bEEF",
      amount: "120000",
      paymentHash: H("c"),
      payloadDigest: H("d"),
      expiresAt: "2000000000",
    };
    expect(ResolutionVoucherMessage.safeParse(voucher).success).toBe(true);
    expect(ResolutionVoucherMessage.safeParse({ ...voucher, expiresAt: "18446744073709551616" }).success).toBe(false);
    expect(ResolutionVoucherMessage.safeParse({ ...voucher, nonce: "1" }).success).toBe(false);
    expect(
      SignedResolutionVoucher.safeParse({
        schemaVersion: "1",
        chainId: 421614,
        verifyingContract: "0xF2E246BB76DF876Cef8b38ae84130F4F55De395b",
        signer: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
        signature: `0x${"1".repeat(130)}`,
        voucher,
      }).success,
    ).toBe(true);
    const resolution = {
      schemaVersion: "1",
      resolutionId: H("a"),
      previewId: H("e"),
      releaseId: H("b"),
      release: "demo@1.0.0",
      buyer: voucher.buyer,
      priceAtomic: "120000",
      paymentHash: H("c"),
      payloadDigest: H("d"),
      bundle: sampleBundle(),
      acceptance: { argv: [["npx", "--no", "vitest", "run"]], timeoutMs: 60000, env: [] },
      issuedAt: "2026-10-02T00:00:00Z",
      expiresAt: "2026-10-05T00:00:00Z",
    };
    expect(CompatibilityResolution.safeParse(resolution).success).toBe(true);
    expect(CompatibilityResolution.safeParse({ ...resolution, priceAtomic: 120000 }).success).toBe(false);
    const receipt = {
      schemaVersion: "1",
      resolutionId: H("a"),
      outcome: "passed",
      testSummary: { passed: 3, failed: 0, skipped: 0, durationMs: 1200, exitCode: 0 },
      filesChanged: 3,
      evidenceDigest: H("f"),
      buyer: voucher.buyer,
      signedAt: "2026-10-02T00:00:00Z",
    };
    expect(AdoptionReceipt.safeParse(receipt).success).toBe(true);
    expect(AdoptionReceipt.safeParse({ ...receipt, outcome: "refund-me" }).success).toBe(false);
  });
});

describe("repository profile", () => {
  it("builds an allowlisted profile from package.json", () => {
    const p = profileFromPackageJson(
      {
        name: "secret-internal-name",
        type: "module",
        engines: { node: ">=22" },
        scripts: { test: "vitest run" },
        dependencies: { "@modelcontextprotocol/sdk": "1.30.1", zod: "^4.0.0", "left-pad": "1.0.0" },
        devDependencies: { typescript: "7.0.2", vitest: "5.0.1" },
      },
      `0x${"9".repeat(64)}`,
      { lockfileKind: "package-lock.json" },
    );
    expect(p).toEqual({
      schemaVersion: "1",
      language: "typescript",
      packageManager: "npm",
      nodeEngine: ">=22",
      lockfile: { present: true, kind: "package-lock.json", digest: `0x${"9".repeat(64)}` },
      dependencies: { "@modelcontextprotocol/sdk": "1.30.1", typescript: "7.0.2", vitest: "5.0.1" },
      moduleSystem: "esm",
      frameworks: { mcpSdk: true, hono: false, express: false, x402: false },
      testRunner: "vitest",
    });
    expect(JSON.stringify(p)).not.toContain("secret-internal-name");
    expect(JSON.stringify(p)).not.toContain("left-pad");
  });

  it("uses locked versions when provided and tolerates garbage input", () => {
    const p = profileFromPackageJson({ dependencies: { zod: "^4.0.0" } }, null, { lockedVersions: { zod: "4.6.5" } });
    expect(p.dependencies).toEqual({ zod: "4.6.5" });
    expect(p.language).toBe("javascript");
    expect(p.moduleSystem).toBe("commonjs");
    expect(profileFromPackageJson("not json", null).dependencies).toEqual({});
  });

  it("rejects unknown profile fields and non-allowlisted dependencies", () => {
    const p = nonNodeProfile("python", "pip");
    expect(RepositoryProfile.safeParse(p).success).toBe(true);
    expect(RepositoryProfile.safeParse({ ...p, files: ["src/a.py"] }).success).toBe(false);
    expect(RepositoryProfile.safeParse({ ...p, dependencies: { "left-pad": "1.0.0" } }).success).toBe(false);
  });
});

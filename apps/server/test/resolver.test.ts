import { loadCatalog } from "@lemma/catalog";
import { nonNodeProfile, type CapabilityRelease, type TaskRequest } from "@lemma/core";
import { describe, expect, it } from "vitest";

import { ResolverInputError, resolve } from "../src/resolver.js";

const catalog = loadCatalog();
const now = new Date("2026-10-02T12:00:00Z");
const task = (kind: TaskRequest["kind"]): TaskRequest => ({ schemaVersion: "1", kind, network: "arbitrum-sepolia" });

describe("resolver against real fixtures", () => {
  for (const fixture of catalog.listFixtures()) {
    it(`${fixture.id} -> ${fixture.task}: ${fixture.expectedDecision}`, () => {
      const preview = resolve(task(fixture.task as TaskRequest["kind"]), catalog.fixtureProfile(fixture.id), catalog, now);
      expect(preview.decision, preview.reasons.join("\n")).toBe(fixture.expectedDecision);
      if (preview.decision === "reuse" || preview.decision === "adapt") {
        expect(preview.release).toBe(fixture.release);
        expect(preview.priceAtomic).toBe("120000");
        expect(preview.evidence?.status).toBe("provisional");
        expect(preview.warranty?.claimWindowSeconds).toBe(259200);
      } else {
        expect(preview.priceAtomic).toBeNull();
        expect(preview.warranty).toBeNull();
        expect(preview.purchasable).toBe(false);
      }
    });
  }
});

describe("purchasability", () => {
  const exact = catalog.fixtureProfile("mcp-server-exact");

  it("is not purchasable with provisional evidence by default", () => {
    const p = resolve(task("x402-paywall-mcp-server"), exact, catalog, now);
    expect(p.decision).toBe("reuse");
    expect(p.purchasable).toBe(false);
    expect(p.provisionalOverride).toBe(false);
    expect(p.reasons.join(" ")).toContain("no frozen benchmark");
  });

  it("allows the explicit testnet provisional override", () => {
    const p = resolve(task("x402-paywall-mcp-server"), exact, catalog, now, { allowProvisional: true });
    expect(p.purchasable).toBe(true);
    expect(p.provisionalOverride).toBe(true);
    expect(p.evidence?.status).toBe("provisional");
  });

  const benchmarked = (saving: string): CapabilityRelease => ({
    ...catalog.listReleases().find((r) => r.id === "x402-mcp-server@1.0.0")!,
    evidence: { status: "benchmarked", benchmarkVersion: "bench-1", expectedSavingAtomic: saving, expectedTokenSaving: 50000 },
  });

  it("is purchasable when price <= 30% of measured saving", () => {
    const p = resolve(task("x402-paywall-mcp-server"), exact, [benchmarked("400000")], now);
    expect(p.purchasable).toBe(true);
    expect(p.provisionalOverride).toBe(false);
    expect(p.expectedSavingAtomic).toBe("400000");
  });

  it("is never purchasable when a benchmark fails the pricing rule, even with the override", () => {
    const p = resolve(task("x402-paywall-mcp-server"), exact, [benchmarked("399999")], now, { allowProvisional: true });
    expect(p.decision).toBe("reuse");
    expect(p.purchasable).toBe(false);
  });
});

describe("hard filters and edge cases", () => {
  it("builds when the only release has expired", () => {
    const p = resolve(task("x402-paywall-mcp-server"), catalog.fixtureProfile("mcp-server-exact"), catalog, new Date("2030-01-01T00:00:00Z"));
    expect(p.decision).toBe("build");
    expect(p.reasons.join(" ")).toContain("expired");
  });

  it("builds for a known task kind with no curated release, declines for unsupported languages", () => {
    expect(resolve(task("x402-facilitator-hono"), catalog.fixtureProfile("mcp-server-exact"), catalog, now).decision).toBe("build");
    expect(resolve(task("x402-facilitator-hono"), nonNodeProfile("python"), catalog, now).decision).toBe("decline");
  });

  it("builds when a dependency is outside the boundary", () => {
    const profile = { ...catalog.fixtureProfile("mcp-server-exact"), dependencies: { "@modelcontextprotocol/sdk": "2.0.0", zod: "4.6.5" } } as const;
    const p = resolve(task("x402-paywall-mcp-server"), profile, catalog, now);
    expect(p.decision).toBe("build");
    expect(p.reasons.join(" ")).toContain("outside");
  });

  it("declines a repository that already integrates x402", () => {
    const base = catalog.fixtureProfile("mcp-server-exact");
    const p = resolve(task("x402-paywall-mcp-server"), { ...base, frameworks: { ...base.frameworks, x402: true } }, catalog, now);
    expect(p.decision).toBe("decline");
  });

  it("is deterministic", () => {
    const a = resolve(task("x402-paying-mcp-client"), catalog.fixtureProfile("mcp-client-boundary"), catalog, now);
    const b = resolve(task("x402-paying-mcp-client"), catalog.fixtureProfile("mcp-client-boundary"), catalog, now);
    expect(a).toEqual(b);
    expect(a.decision).toBe("adapt");
    expect(a.reasons.join(" ")).toContain("differs from benchmarked");
  });

  it("fails closed on invalid inputs", () => {
    const profile = catalog.fixtureProfile("mcp-server-exact");
    expect(() => resolve({ ...task("x402-paywall-mcp-server"), network: "base" } as unknown as TaskRequest, profile, catalog, now)).toThrow(ResolverInputError);
    expect(() => resolve(task("x402-paywall-mcp-server"), { ...profile, path: "/home/me" } as never, catalog, now)).toThrow(ResolverInputError);
    expect(() => resolve(task("x402-paywall-mcp-server"), profile, catalog, new Date("x"))).toThrow(ResolverInputError);
  });
});

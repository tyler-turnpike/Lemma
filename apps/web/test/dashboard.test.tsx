import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApiError, getJson, probe, resolveApiBase } from "../src/api/client.js";
import { parseBenchmarks, parseReceipts, parseReleases, parseResolution, parseStatus } from "../src/api/parse.js";
import { App } from "../src/App.js";
import { dashboard, featured, links } from "../src/content.js";
import { arbiscanAddress, arbiscanTx, githubCommit, safeExternalHref } from "../src/lib/links.js";
import { formatDuration, formatUsdcAtomic } from "../src/lib/format.js";
import { BenchmarkView } from "../src/pages/BenchmarkPage.js";
import { CatalogView } from "../src/pages/CatalogPage.js";
import { ResolutionView, warrantyState } from "../src/pages/ResolutionPage.js";
import { StatusView } from "../src/pages/StatusPage.js";
import { matchRoute } from "../src/router.js";
import receiptsJson from "./fixtures/adoption-receipts.json";
import notRunJson from "./fixtures/benchmarks-not-run.json";
import publishedJson from "./fixtures/benchmarks-published.json";
import releasesJson from "./fixtures/releases.json";
import pendingJson from "./fixtures/resolution-no-receipt.json";
import resolutionJson from "./fixtures/resolution.json";
import statusConfiguredJson from "./fixtures/status-configured.json";
import statusJson from "./fixtures/status.json";

const loading = { status: "loading" } as const;
const offline = { status: "error", error: { kind: "offline" } } as const;
const ready = <T,>(data: T) => ({ status: "ready", data }) as const;

/** All href attribute values in rendered markup. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
}

function expectOnlyAllowedLinks(html: string) {
  for (const href of hrefs(html)) {
    if (href.startsWith("/")) continue;
    expect(safeExternalHref(href), href).not.toBeNull();
  }
}

describe("link allowlist", () => {
  it("accepts only https Arbiscan Sepolia and GitHub destinations", () => {
    expect(safeExternalHref("https://sepolia.arbiscan.io/tx/0xabc")).toBe("https://sepolia.arbiscan.io/tx/0xabc");
    expect(safeExternalHref("https://github.com/tyler-turnpike/Lemma")).toBe("https://github.com/tyler-turnpike/Lemma");
    for (const bad of [
      "http://github.com/x/y",
      "https://arbiscan.io/tx/0x1",
      "https://etherscan.io/tx/0x1",
      "https://github.com.evil.example/x",
      "https://evil.example/?u=https://github.com",
      "https://user:pass@github.com/x",
      "https://github.com:8443/x",
      "javascript:alert(1)",
      "data:text/html,hi",
      "//github.com/x",
      "/catalog",
      "",
      null,
      42,
    ]) {
      expect(safeExternalHref(bad), String(bad)).toBeNull();
    }
  });

  it("builds explorer and commit links only from well-formed values", () => {
    const tx = `0x${"ab".repeat(32)}`;
    expect(arbiscanTx(tx)).toBe(`https://sepolia.arbiscan.io/tx/${tx}`);
    expect(arbiscanTx("0x123")).toBeNull();
    expect(arbiscanTx(`${tx}/../../evil`)).toBeNull();
    expect(arbiscanAddress("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d")).toContain("/address/");
    expect(arbiscanAddress("javascript:alert(1)")).toBeNull();
    const commit = "71eb9a55e081e7b81ba3046d0bd17c3eb9c7bf81";
    expect(githubCommit("https://github.com/x402-foundation/x402", commit)).toBe(`https://github.com/x402-foundation/x402/commit/${commit}`);
    expect(githubCommit("https://gitlab.com/x402-foundation/x402", commit)).toBeNull();
    expect(githubCommit("https://github.com/a/b/tree/main", commit)).toBeNull();
    expect(githubCommit("https://github.com/x402-foundation/x402", "main")).toBeNull();
  });

  it("renders untrusted URLs as text, never as links", () => {
    const evil = parseReleases(releasesJson);
    const tampered = {
      releases: [{ ...evil.releases[0]!, provenance: { ...evil.releases[0]!.provenance, upstreamRepo: "https://evil.example/x/y" } }],
    };
    const html = renderToStaticMarkup(<CatalogView state={ready(tampered)} />);
    expect(html).not.toContain("evil.example/x/y/commit");
    expect(hrefs(html).some((h) => h.includes("evil.example"))).toBe(false);
    expectOnlyAllowedLinks(html);
  });

  it("keeps every static landing and footer destination on the allowlist", () => {
    for (const href of Object.values(links)) expect(safeExternalHref(href)).not.toBeNull();
    const html = renderToStaticMarkup(<App path="/" />);
    expect(hrefs(html)).not.toContain("#");
    expectOnlyAllowedLinks(html);
  });
});

describe("router", () => {
  it("matches dashboard paths", () => {
    expect(matchRoute("/")).toEqual({ name: "landing" });
    expect(matchRoute("/catalog")).toEqual({ name: "catalog" });
    expect(matchRoute("/catalog/")).toEqual({ name: "catalog" });
    expect(matchRoute("/benchmark")).toEqual({ name: "benchmark" });
    expect(matchRoute("/status")).toEqual({ name: "status" });
    expect(matchRoute("/resolutions")).toEqual({ name: "resolution-lookup" });
    expect(matchRoute("/resolutions/0xabc")).toEqual({ name: "resolution", id: "0xabc" });
    expect(matchRoute("/resolutions/a/b")).toEqual({ name: "not-found" });
    expect(matchRoute("/nope")).toEqual({ name: "not-found" });
  });

  it("server-renders each route in its loading state with nav links routed", () => {
    for (const path of ["/catalog", "/benchmark", "/status", `/resolutions/0x${"ab".repeat(32)}`]) {
      const html = renderToStaticMarkup(<App path={path} />);
      expect(html, path).toContain('data-state="loading"');
      expect(html).toContain('href="/catalog"');
      expect(html).toContain('href="/status"');
      expect(html).toContain('href="/benchmark"');
      expect(html).toContain(`href="${links.docs}"`);
      expect(html).toContain(`href="${links.securityModel}"`);
    }
    expect(renderToStaticMarkup(<App path="/missing" />)).toContain(dashboard.notFound.title);
  });
});

describe("API client", () => {
  const json = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("reports offline for network failures and non-JSON answers", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(getJson("/api/v1/status", parseStatus, { fetchImpl: down })).rejects.toMatchObject({ failure: { kind: "offline" } });
    const html = vi.fn(async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(getJson("/api/v1/status", parseStatus, { fetchImpl: html })).rejects.toMatchObject({ failure: { kind: "offline" } });
    expect(await probe("/health", { fetchImpl: html })).toBeNull();
  });

  it("classifies server errors and rejects malformed bodies", async () => {
    await expect(getJson("/x", parseResolution, { fetchImpl: json(404, { error: { code: "not_found", message: "m" } }) })).rejects.toMatchObject({
      failure: { kind: "not_found" },
    });
    await expect(getJson("/x", parseResolution, { fetchImpl: json(400, { error: { code: "invalid_input" } }) })).rejects.toMatchObject({
      failure: { kind: "invalid_input" },
    });
    await expect(getJson("/x", parseStatus, { fetchImpl: json(200, { version: 1 }) })).rejects.toBeInstanceOf(ApiError);
    await expect(getJson("/x", parseStatus, { fetchImpl: json(200, statusJson) })).resolves.toMatchObject({ chain: { chainId: 421614 } });
  });

  it("accepts only a public http(s) API base", () => {
    expect(resolveApiBase(undefined)).toBe("");
    expect(resolveApiBase("https://lemma.example/")).toBe("https://lemma.example");
    expect(resolveApiBase("http://localhost:3000")).toBe("http://localhost:3000");
    expect(resolveApiBase("http://lemma.example")).toBe("");
    expect(resolveApiBase("https://user:pw@lemma.example")).toBe("");
    expect(resolveApiBase("javascript:alert(1)")).toBe("");
  });
});

describe("catalog view", () => {
  const data = parseReleases(releasesJson);

  it("renders loading, offline and empty states", () => {
    expect(renderToStaticMarkup(<CatalogView state={loading} />)).toContain('data-state="loading"');
    const off = renderToStaticMarkup(<CatalogView state={offline} />);
    expect(off).toContain(dashboard.states.offline.title);
    expect(renderToStaticMarkup(<CatalogView state={ready({ releases: [] })} />)).toContain(dashboard.catalog.empty.title);
  });

  it("renders every release field from the server's shape", () => {
    const html = renderToStaticMarkup(<CatalogView state={ready(data)} />);
    for (const release of data.releases) {
      expect(html).toContain(release.title);
      expect(html).toContain(release.taskKind);
      expect(html).toContain(release.limitations[0]!.replaceAll("'", "&#x27;"));
      expect(html).toContain(`https://github.com/x402-foundation/x402/commit/${release.provenance.commit}`);
    }
    expect(html).toContain("0.12 USDC");
    expect(html).toContain("72 hours");
    expect(html).toContain("Apr 1, 2027");
    expect(html).toContain("Apache-2.0");
    expect(html).toContain(dashboard.catalog.evidence.provisional);
    expect(html).toContain(dashboard.catalog.evidence.published);
    expect(html).not.toContain("bg-mint-soft");
    // Only the release that was actually bought links to the live purchase.
    expect(html.split(dashboard.catalog.evidence.livePurchase).length - 1).toBe(1);
    expect(html).toContain(`href="/resolutions/${featured.resolutionId}"`);
    expectOnlyAllowedLinks(html);
  });

  it("marks benchmarked releases with the success badge", () => {
    const r = data.releases[0]!;
    const benchmarked = { ...r, evidence: { status: "benchmarked" as const, benchmarkVersion: "v1", expectedSavingAtomic: "500000", expectedTokenSaving: 1000 } };
    const html = renderToStaticMarkup(<CatalogView state={ready({ releases: [benchmarked] })} />);
    expect(html).toContain(dashboard.catalog.evidence.benchmarked);
    expect(html).toContain("bg-mint-soft");
  });

  it("escapes hostile release text", () => {
    const r = data.releases[0]!;
    const html = renderToStaticMarkup(<CatalogView state={ready({ releases: [{ ...r, title: "<img src=x onerror=alert(1)>" }] })} />);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("resolution view", () => {
  const summary = parseResolution(resolutionJson);
  const receipts = parseReceipts(receiptsJson);
  const id = summary.resolutionId;
  const now = Date.parse("2026-10-02T20:00:00Z");

  it("renders loading, invalid id and not-found states", () => {
    expect(renderToStaticMarkup(<ResolutionView id={id} state={loading} />)).toContain('data-state="loading"');
    expect(renderToStaticMarkup(<ResolutionView id="0x123" state={loading} />)).toContain(dashboard.resolution.invalid.title);
    const missing = renderToStaticMarkup(<ResolutionView id={id} state={{ status: "error", error: { kind: "not_found" } }} />);
    expect(missing).toContain(dashboard.resolution.notFound.title);
    expect(renderToStaticMarkup(<ResolutionView id={id} state={offline} />)).toContain(dashboard.states.offline.title);
  });

  it("shows payment, voucher, warranty and receipt with explorer links", () => {
    const html = renderToStaticMarkup(<ResolutionView id={id} state={ready({ summary, receipts })} now={now} />);
    expect(html).toContain(`href="https://sepolia.arbiscan.io/tx/${summary.payment!.txHash}"`);
    expect(html).toContain(`https://sepolia.arbiscan.io/address/${summary.voucher!.verifyingContract}`);
    expect(html).toContain(summary.release);
    expect(html).toContain("Settled");
    expect(html).toContain("Passed");
    expect(html).toContain("3 passed");
    expect(html).toContain(dashboard.resolution.warrantyNote);
    expect(html).toContain("Activation window open");
    expectOnlyAllowedLinks(html);
  });

  it("never renders bundle internals even if the API were to send them", () => {
    const leaky = { ...resolutionJson, bundle: { operations: [{ contentBase64: "U0VDUkVU" }] }, acceptance: { argv: [["npx", "--no", "secret-cmd"]] } };
    const html = renderToStaticMarkup(<ResolutionView id={id} state={ready({ summary: parseResolution(leaky), receipts: null })} now={now} />);
    expect(html).not.toContain("U0VDUkVU");
    expect(html).not.toContain("secret-cmd");
    expect(html).not.toContain("contentBase64");
  });

  it("derives warranty state honestly", () => {
    const noReceipt = parseResolution(pendingJson);
    expect(warrantyState(noReceipt, now).label).toBe("Activation window open");
    expect(warrantyState(noReceipt, Date.parse("2030-01-01T00:00:00Z")).label).toBe("Activation deadline passed");
    expect(warrantyState({ ...noReceipt, voucher: null, status: "pending" }, now).label).toBe("Not issued");
    expect(warrantyState({ ...noReceipt, receipts: { count: 1, latestOutcome: "failed", latestAt: null } }, now).label).toBe("Failure reported");
    const html = renderToStaticMarkup(<ResolutionView id={id} state={ready({ summary: noReceipt, receipts: { resolutionId: id, receipts: [] } })} now={now} />);
    expect(html).toContain(dashboard.resolution.noReceipts);
    expect(html).toContain("Awaiting");
  });
});

describe("benchmark view", () => {
  it("renders loading and offline states", () => {
    expect(renderToStaticMarkup(<BenchmarkView state={loading} />)).toContain('data-state="loading"');
    expect(renderToStaticMarkup(<BenchmarkView state={offline} />)).toContain(dashboard.states.offline.title);
  });

  it("states the 25% target is a target when no benchmark has run", () => {
    const html = renderToStaticMarkup(<BenchmarkView state={ready(parseBenchmarks(notRunJson))} />);
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("It is a target, not a measured result.");
    expect(html).not.toContain("Meets 25% target");
    expect(html).not.toContain("bg-mint-soft");
  });

  it("renders per-arm medians, reductions, pass rates and no-match spend with testnet n labels", () => {
    const html = renderToStaticMarkup(<BenchmarkView state={ready(parseBenchmarks(publishedJson))} />);
    expect(html).toContain('data-state="ready"');
    expect(html).toContain("n=20");
    expect(html).toContain("Control · n=9");
    expect(html).toContain("Testnet");
    expect(html).toContain("$1.84");
    expect(html).toContain("1,210,000");
    expect(html).toContain("34% lower");
    expect(html).toContain("100%");
    expect(html).toContain("0 USDC");
    expect(html).toContain("Zero spend");
    expect(html).toContain("of 20 planned");
    expect(html).toContain("Validated");
    expect(html).toContain("not charged amounts");
  });

  it("shows a missed target without a success badge", () => {
    const missed = structuredClone(publishedJson) as typeof publishedJson;
    Object.assign(missed.aggregate, { verdict: "not-validated", reductions: { allInCost: 0.12, totalTokens: -0.05 } });
    Object.assign(missed.aggregate.criteria, { costTargetMet: false, tokenTargetMet: false, allMet: false });
    missed.aggregate.noMatch.treatmentUsdcSpentAtomic = "120000";
    const html = renderToStaticMarkup(<BenchmarkView state={ready(parseBenchmarks(missed))} />);
    expect(html).toContain("12% lower");
    expect(html).toContain("5% higher");
    expect(html).toContain("Below 25% target");
    expect(html).toContain("Target not met");
    expect(html).toContain("Paid on no-match");
    expect(html).not.toContain("Meets 25% target");
  });

  it("shows cost increases above 100% without rescaling them", () => {
    const worse = structuredClone(publishedJson) as typeof publishedJson;
    Object.assign(worse.aggregate, { verdict: "not-validated", reductions: { allInCost: -2.883, totalTokens: 0.749 } });
    const html = renderToStaticMarkup(<BenchmarkView state={ready(parseBenchmarks(worse))} />);
    expect(html).toContain("288% higher");
    expect(html).toContain("75% lower");
  });

  it("refuses to guess at an unrecognised aggregate", () => {
    const html = renderToStaticMarkup(<BenchmarkView state={ready(parseBenchmarks({ status: "published", aggregate: { foo: 1 } }))} />);
    expect(html).toContain(dashboard.benchmark.unrecognised);
  });
});

describe("status view", () => {
  const record = (json: unknown) => ({
    status: parseStatus(json),
    health: { state: "ok", detail: null } as const,
    facilitator: { state: "disabled" } as const,
  });

  it("shows the trust notice in every state, including offline", () => {
    for (const state of [loading, offline, ready(record(statusJson))]) {
      const html = renderToStaticMarkup(<StatusView state={state} />);
      expect(html).toContain("The evaluator is a team-operated key, not decentralized arbitration.");
      expect(html).toContain("Testnet only");
    }
    expect(renderToStaticMarkup(<StatusView state={offline} />)).toContain(dashboard.states.offline.title);
  });

  it("renders unconfigured roles and disabled services", () => {
    const html = renderToStaticMarkup(<StatusView state={ready(record(statusJson))} />);
    expect(html).toContain(dashboard.status.notConfigured);
    expect(html).toContain("https://sepolia.arbiscan.io/token/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
    expect(html).toContain("Disabled");
    expect(html).toContain("arbitrum-sepolia");
    expectOnlyAllowedLinks(html);
  });

  it("links configured contracts and role addresses on Arbiscan", () => {
    const status = parseStatus(statusConfiguredJson);
    const html = renderToStaticMarkup(<StatusView state={ready({ ...record(statusConfiguredJson), facilitator: { state: "ok", detail: "exact · eip155:421614" } })} />);
    expect(html).toContain(`https://sepolia.arbiscan.io/address/${status.registry}`);
    expect(html).toContain(`https://sepolia.arbiscan.io/address/${status.provider}`);
    expect(html).toContain(`https://sepolia.arbiscan.io/address/${status.evaluator}`);
    expect(html).toContain("Operational");
    expectOnlyAllowedLinks(html);
  });
});

describe("formatting", () => {
  it("formats USDC atomic amounts without floats", () => {
    expect(formatUsdcAtomic("120000")).toBe("0.12 USDC");
    expect(formatUsdcAtomic("1000000")).toBe("1 USDC");
    expect(formatUsdcAtomic("100000")).toBe("0.10 USDC");
    expect(formatUsdcAtomic("1.5")).toBe("—");
    expect(formatDuration(259_200)).toBe("72 hours");
    expect(formatDuration(604_800)).toBe("7 days");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.js";
import { figuresFrom, fallbackFigures } from "../src/components/LiveProof.js";
import { closing, featured, footer, guarantees, hero, howItWorks, mock, nav, whyArbitrum } from "../src/content.js";
import { decisionCard, mockSteps, mockTitle } from "../src/components/mock/mockScript.js";
import { parseBenchmarks } from "../src/api/parse.js";
import { safeExternalHref } from "../src/lib/links.js";
import publishedJson from "./fixtures/benchmarks-published.json";

const decode = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

describe("landing page", () => {
  const html = renderToStaticMarkup(<App />);
  const text = decode(html);

  it("renders every section in order", () => {
    const order = [
      hero.headline[0],
      hero.lede,
      featured.settlementTx.slice(0, 10),
      howItWorks.label,
      guarantees.label,
      whyArbitrum.label,
      closing.headline[0],
      footer.network,
    ];
    const positions = order.map((t) => text.indexOf(t));
    expect(positions.every((position) => position >= 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("links the featured live resolution and its Arbiscan receipts", () => {
    expect(html).toContain(`href="/resolutions/${featured.resolutionId}"`);
    expect(html).toContain(`href="https://sepolia.arbiscan.io/tx/${featured.settlementTx}"`);
    expect(html).toContain(`href="https://sepolia.arbiscan.io/tx/${featured.refundTx}"`);
    expect(html).toContain(`href="https://sepolia.arbiscan.io/address/${featured.registry}"`);
    expect(html).toContain("Live on Arbitrum Sepolia");
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
      if (href!.startsWith("/")) continue;
      expect(safeExternalHref(href!.replaceAll("&amp;", "&")), href).not.toBeNull();
    }
  });

  it("points GitHub links at the submission branch, not the bare main scaffold", () => {
    expect(html).toContain("https://github.com/tyler-turnpike/Lemma/tree/claude/happy-lovelace-tk3hme");
    expect(html).not.toContain("/blob/main/");
  });

  it("puts the agent demo in the hero, above the live proof strip", () => {
    const heroAt = text.indexOf(hero.headline[0]);
    const demoAt = text.indexOf(mock.illustrative);
    const proofAt = text.indexOf(featured.settlementTx.slice(0, 10));
    expect(heroAt).toBeGreaterThanOrEqual(0);
    expect(demoAt).toBeGreaterThan(heroAt);
    expect(demoAt).toBeLessThan(proofAt);
    // Exactly one terminal: the hero's.
    expect(text.split(mockTitle).length - 1).toBe(1);
    expect(text.split("Lemma · preview").length - 1).toBe(1);
    expect(text).toContain(mock.replay);
  });

  it("server-renders the mock at its final frame, labelled illustrative with the real tx", () => {
    expect(html).toContain(decisionCard.release);
    expect(html).not.toContain("invisible translate-y-1");
    const last = mockSteps.at(-1)?.line;
    expect(last?.kind === "ok" && text.includes(last.text)).toBe(true);
    expect(html).toContain(mock.illustrative);
    expect(html).not.toContain("0x9f3c");
    expect(text).toContain(`${featured.settlementTx.slice(0, 6)}…${featured.settlementTx.slice(-4)}`);
  });

  it("states the benchmark honestly and drops the old pitch", () => {
    expect(html).toContain("Arbitrum Sepolia testnet");
    expect(html).toContain("quoted per request");
    expect(html).not.toContain("0.12");
    expect(html).toContain("75%");
    expect(html).toContain("All-in cost not yet lower");
    expect(html).not.toContain("Stop paying");
    expect(html).not.toContain("Stop rediscovering");
  });

  it("renders a mobile menu with the main links", () => {
    expect(html).toContain("data-mobile-menu");
    expect(html).toContain(`aria-label="${nav.menu.open}"`);
    expect(html).toContain('aria-expanded="false"');
    const menu = html.slice(html.indexOf("data-mobile-menu"));
    for (const link of nav.links) expect(menu).toContain(`>${link.label}</a>`);
  });
});

describe("live proof figures", () => {
  it("uses the published benchmark when available and falls back otherwise", () => {
    const published = parseBenchmarks(publishedJson);
    const aggregate = published.status === "published" ? published.aggregate : null;
    const live = figuresFrom(aggregate);
    expect(live.treatmentRuns).toBeGreaterThan(0);
    expect(figuresFrom(null)).toEqual(fallbackFigures);
    expect(Math.round(fallbackFigures.tokenReduction * 100)).toBe(75);
    expect(fallbackFigures.costReduction).toBeLessThan(0);
    expect(`${fallbackFigures.treatmentPassed}/${fallbackFigures.treatmentRuns}`).toBe("9/9");
    expect(`${fallbackFigures.controlSeconds}s`).toBe("96s");
    expect(`${fallbackFigures.treatmentSeconds}s`).toBe("42s");
  });
});

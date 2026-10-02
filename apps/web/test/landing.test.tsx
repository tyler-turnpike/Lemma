import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.js";
import { closing, footer, guarantees, hero, mock } from "../src/content.js";
import { decisionCard, mockSteps } from "../src/components/mock/mockScript.js";

describe("landing page", () => {
  const html = renderToStaticMarkup(<App />);

  it("renders every section in order", () => {
    const order = [hero.headline[0], mock.label, guarantees.label, closing.headline[0], footer.network];
    const positions = order.map((text) => html.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("server-renders the mock at its final frame", () => {
    expect(html).toContain(decisionCard.release);
    expect(html).not.toContain("invisible translate-y-1");
    const last = mockSteps.at(-1)?.line;
    expect(last?.kind === "ok" && html.includes(last.text)).toBe(true);
  });

  it("labels testnet data and states the benchmark verdict honestly", () => {
    expect(html).toContain("Arbitrum Sepolia testnet");
    expect(html).toContain("cost not validated");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { quoteFor } from "../../../packages/core/src/pricing.js";
import { Pricing } from "../src/components/Pricing.js";
import { pricing } from "../src/content.js";
import { FEATURED_QUOTE_BASIS, QUOTE_MODELS, browserQuote } from "../src/lib/quote.js";

describe("landing quote calculator", () => {
  it("matches the core quote rule for every model", () => {
    for (const m of QUOTE_MODELS) {
      const core = quoteFor({ floorAtomic: FEATURED_QUOTE_BASIS.floorAtomic, expectedSavingAtomic: FEATURED_QUOTE_BASIS.expectedSavingAtomic, basisModel: FEATURED_QUOTE_BASIS.basis, model: m.id })!;
      expect(browserQuote(m.id), m.id).toEqual({
        expectedSavingAtomic: core.expectedSavingAtomic,
        floorAtomic: core.floorAtomic,
        successFeeAtomic: core.successFeeAtomic,
        totalAtomic: core.totalAtomic,
      });
    }
  });

  it("server-renders the terra quote by default", () => {
    const html = renderToStaticMarkup(<Pricing />);
    expect(html).toContain(pricing.headline[0]);
    expect(html).toContain("0.005 USDC");
    expect(html).toContain("0.053 USDC");
    expect(html).toContain("0.058 USDC");
    expect(html).toContain('aria-checked="true"');
  });
});

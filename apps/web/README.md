# Lemma Web Dashboard

## Purpose and economic role

The dashboard makes the economic claim inspectable. It shows what a buyer can buy and why, what evidence supports each price, what agents asked for that Lemma could not sell, and what happened to a resolution after it was paid.

## Views

The server serves the built dashboard at `/` (see the server README). Views are addressed by URL fragment, so the server serves one page:

| Fragment | View | Read model |
| --- | --- | --- |
| `#/` | What Lemma sells, the four preview answers, live figures, how a purchase flows (each step marked built or in progress), what leaves the buyer's machine, the pricing rule with a calculator, and what to trust | `CatalogView`, `StatusView`; the calculator runs core `maxPriceFor` and `allInReductionBps` in the browser |
| `#/catalog` | Every release: provenance, price, warranty, and per profile the platform, evidence label, whether it can be sold and why not, the all-in reduction at the list price, and the highest price that keeps the benchmark target. A capability without a release is listed with its free build answer | `CatalogView` |
| `#/evidence` | The benchmark protocol's fixed parameters and every evidenced profile with its numbers and cost chart; an empty state while no frozen benchmark has run | `CatalogView` |
| `#/resolutions` | Look up a resolution by its public id | none |
| `#/resolutions/<id>` | One resolution's lifecycle (quote, payment, adoption receipt, warranty), terms and digests | `ResolutionView` |
| `#/demand` | Unmet demand ranked by repositories: what to build next | `DemandView`, ranked by core `rankUnmetDemand` |
| `#/status` | Service, purchases, economics, storage, network and catalog, and the settlement contracts | `StatusView` |
| `#/setup` | Build the bridge, register it with the agent (the MCP configuration names this server's own origin), install the rule, the tools the agent sees, and the bridge's settings | none (static) |

Every response is parsed with its core schema before anything is rendered; an answer that does not match is shown as an error. Nothing is invented where the product is unfinished: warranty activation, the registry address and paid purchases are shown as in progress until the payment work adds them to the read models.

## Design

- One stylesheet, `src/styles.css`, built on color tokens. Light and dark follow `prefers-color-scheme`. Every text color pair clears 4.5:1 contrast, and the chart's three series pass the data-visualization palette checks (lightness, chroma, color-vision-deficiency separation) on both surfaces.
- System fonts only, and icons and charts are inline SVG, so the page needs nothing from another origin.
- Components live in `src/components/`. The cost chart (`CostChart.tsx`) compares building alone with buying a resolution on one axis. It measures its own width, so marks are drawn in pixels, and it always carries a values table, so no number needs hovering to read.
- The pricing calculator (`src/calculator.ts`) is pure and uses core's pricing functions, so the page and `catalog:check` cannot disagree.

## Outside this boundary

- Holding any private key.
- Constructing or signing x402 payments.
- Applying patches.
- Evaluating warranty claims.
- Serving as an authorization boundary.

## Workspace dependencies

- React and Vite for the client application.
- `@lemma/core` for the read-model schemas, amounts, pricing functions and the unmet-demand ranking.

## Environment variables

None in the build: the dashboard calls the API on its own origin. For `npm run dev` only, `LEMMA_API_URL` (default `http://127.0.0.1:3000`) is where the Vite dev server proxies `/api` to.

## Development and tests

- `npm run dev -w @lemma/web`: serves the page with hot reload and proxies `/api` to a running Lemma server (`LEMMA_API_URL`).
- `npm run build -w @lemma/web`
- `npm run bundle -w @lemma/web`: builds `dist/` and then checks every file in it (`scripts/check-dist.mjs`): no inline script, style or event handler, every reference an existing file under `/assets/` with a name the server serves (so no other origin and no `data:` URI), no `@import` or foreign `url()` in CSS, and no source maps or source-map references.
- `npm run test -w @lemma/web`: every view renders from read models, catalog prose is escaped, outbound links are allowlisted, and a malformed answer is never rendered.

## Security constraints

- Text is rendered through React escaping only; there is no raw HTML.
- The server's CSP allows scripts, styles, images, fonts and API calls from this origin only, with no inline code, no eval, no framing and no forms. zod is set to jitless before any schema is built, so its eval probe never runs.
- Nothing is kept in browser storage, and requests carry no credentials.
- The only outbound links are GitHub repositories at a full commit and Arbitrum Sepolia explorer pages for an address, both rebuilt from validated parts.
- No production source maps.
- Testnet, provisional and unverified states are labeled wherever they appear.

## Later completion criteria

This component is complete when every demo payment and warranty state can be independently inspected, all claims are evidence-linked and correctly labeled, and no sensitive server configuration is present in the browser bundle.

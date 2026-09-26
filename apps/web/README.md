# Lemma Web Dashboard

## Purpose and economic role

The dashboard makes the economic claim inspectable. It shows what a buyer can buy and why, what evidence supports each price, what agents asked for that Lemma could not sell, and what happened to a resolution after it was paid.

## Views

The server serves the built dashboard at `/` (see the server README). Views are addressed by URL fragment, so the server serves one page:

| Fragment | View | Read model |
| --- | --- | --- |
| `#/` | Home: one sentence and an example session, the three steps (check, buy, apply) with live or coming-soon chips, why it pays (the worked example's cost chart), why Arbitrum, live figures from this server, and the call to action | `CatalogView`, `StatusView` |
| `#/how-it-works` | Home, scrolled to the three steps | as above |
| `#/catalog` | One card per release: what it fits, price, warranty, source and expiry, with the release's digest and per-profile table under Details. A capability without a release is listed with its free build answer | `CatalogView` |
| `#/evidence` | Proof: the two-arm benchmark and its fixed parameters, every evidenced profile with its numbers and cost chart (an empty state while no frozen benchmark has run), the pricing rule with a calculator that runs core `maxPriceFor` and `allInReductionBps` in the browser, and what to trust | `CatalogView` |
| `#/what-to-trust` | Proof, scrolled to its limits | as above |
| `#/resolutions` | Look up a resolution by its public id | none |
| `#/resolutions/<id>` | One resolution's lifecycle (quote, payment, adoption receipt, warranty), terms and digests | `ResolutionView` |
| `#/demand` | Unmet demand ranked by repositories: what to build next | `DemandView`, ranked by core `rankUnmetDemand` |
| `#/status` | Service, purchases, economics, storage, network and catalog, and the settlement contracts | `StatusView` |
| `#/setup` | Get started: build the bridge, add it to Cursor, Claude Code or any other MCP agent (the configuration names this server's own origin), install the rule for that agent, and ask for an integration; the tools the agent sees, the bridge's settings and what it never does are collapsed below | none (static) |

The header carries How it works, Catalog, Proof, a Testnet pill and the Get started button; the footer carries the explorer pages (Resolutions, Demand, Status, What to trust). On phones the header links sit behind a menu button.

Every response is parsed with its core schema before anything is rendered; an answer that does not match is shown as an error. Nothing is invented where the product is unfinished: warranty activation, the registry address and paid purchases are shown as in progress until the payment work adds them to the read models.

## Design

- One stylesheet, `src/styles.css`, built on color tokens taken from the logo: ink `#0E1518`, mint `#5FE7BB`, the link green `#0B7458` (mint in dark mode), and status colors. Light and dark follow `prefers-color-scheme`. Every text color pair clears 4.5:1 contrast, and the chart's three series (blue for model cost, brand green for Lemma's price, violet for chain cost) pass the data-visualization palette checks (lightness, chroma, color-vision-deficiency separation) on both surfaces.
- The logo (`src/components/Logo.tsx`) is inline SVG redrawn from the logo file, colored through the stylesheet so it follows the scheme; `MarkMono` is its one-color form for empty states, the footer and the loading indicator. The favicon and touch icons live in `src/favicon.svg` and `src/icons/`, and the full brand files in [docs/brand](../../docs/brand/README.md).
- Fonts are self-hosted from `src/fonts/` (Lexend for headings and the wordmark, Instrument Sans for text, JetBrains Mono for code; latin subsets, SIL Open Font License beside each file), because the server's CSP allows same-origin fonts only. Icons and charts are inline SVG, so the page needs nothing from another origin.
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

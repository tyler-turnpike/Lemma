# Lemma Server

## Purpose and economic role

The server converts a safe task and repository profile into a free preview or a paid Compatibility Resolution. It is the remote coordination boundary between the buyer bridge, the curated catalog, x402 settlement, warranty vouchers, adoption receipts, and the public dashboard.

The server does not make open-source code scarce. It charges for a verified, context-specific integration route and the warranty attached to it.

## Responsibilities

- Host the Streamable HTTP MCP endpoint.
- Evaluate deterministic compatibility rules against the curated catalog.
- Return free no-match and preview results.
- Protect paid resolution tools with x402.
- Host the Arbitrum Sepolia facilitator endpoints.
- Persist previews, payment receipts, resolutions, warranty vouchers, and adoption receipts.
- Serve read-only dashboard APIs and the built web assets.
- Sign provider vouchers only after successful payment settlement.
- Support idempotent recovery after a lost paid response.

## Outside this boundary

- Reading the buyer's repository directly.
- Holding the buyer private key.
- Applying patches to a buyer workspace.
- Executing arbitrary buyer repositories.
- Letting a model authorize payment.
- Adjudicating warranty failures with the provider signing key.

## Status

Implemented: remote MCP (`lemma_preview`, `lemma_purchase_resolution` via x402, `lemma_recover_resolution`, `lemma_submit_receipt`), self-hosted facilitator, Postgres and in-memory persistence, read-only API, static dashboard hosting, security middleware. Verified end to end against an Anvil fork of Arbitrum Sepolia (`scripts/e2e-fork.ts`). The chain-event indexer is not built yet (the cursor table exists).

## Interfaces

- `POST /mcp`: stateless Streamable HTTP (JSON responses). Tools and rules in `docs/interfaces.md`.
- `GET /facilitator/supported`, `POST /facilitator/verify`, `POST /facilitator/settle`: x402 `exact` on `eip155:421614`, restricted to USDC paid to the provider.
- `GET /health`, `GET /api/v1/status`, `/api/v1/releases[/:id]`, `/api/v1/resolutions/:id`, `/api/v1/adoption-receipts?resolutionId=`, `/api/v1/benchmarks`.
- Everything else serves `apps/web/dist` (SPA fallback to `index.html`) when it exists.

## Layout

- `src/index.ts`: process entry (config, migrations, Postgres or in-memory repository, `@hono/node-server`). Importing it does not start a server.
- `src/app.ts`: `createApp(deps)` Hono factory used by the entry and the tests.
- `src/mcp.ts`: MCP tools. `src/service.ts`: preview, purchase gating, settlement finalization, voucher signing, recovery, receipts.
- `src/payments/x402.ts`: `x402ResourceServer` + `ExactEvmScheme`, one cached `createPaymentWrapper` per atomic price (price expressed as an `AssetAmount`).
- `src/payments/facilitator.ts`: `x402Facilitator` + `@x402/evm` exact facilitator with a viem signer, plus an in-process `FacilitatorClient`.
- `src/repository/`: `Repository` interface, `MemoryRepository`, `PostgresRepository` (drizzle + postgres-js), migration runner. SQL lives in `migrations/`.
- `src/resolver.ts`: deterministic catalog resolver.

## Settlement and voucher ordering

`@x402/mcp` verifies the payment, runs the tool handler, settles, then calls `onAfterSettlement`, and only then returns. The server uses that order:

1. Before any payment: the preview must exist, be unexpired and purchasable, its release must still be in the catalog at the same price, and `(previewId, buyer)` must not be settled. The x402 payer must equal `buyer`. One in-flight paid attempt per `(previewId, buyer)`.
2. Handler (after verification, before settlement): pins a `pending` resolution with a stable `resolutionId`.
3. `onAfterSettlement`: validates network, payer and amount, atomically stores the settlement (tx hash unique) and the settled resolution, and signs the voucher with `paymentHash` = settlement tx. It never throws; failures are kept in memory and retried by recovery.
4. The tool returns `{ resolution, voucher }` read back from storage, with the x402 `SettleResponse` in `_meta`.

Voucher signing is deterministic (RFC 6979, expiry derived from the stored settlement time), so re-signing after a crash yields the same voucher.

## Environment variables

`DATABASE_URL` (required in production; otherwise in-memory with a warning), `PUBLIC_BASE_URL` (CORS origin), `PORT`, `ARBITRUM_SEPOLIA_RPC_URL`, `USDC_ADDRESS` (must be Arbitrum Sepolia USDC), `RESOLUTION_WARRANTY_REGISTRY_ADDRESS`, `PROVIDER_ADDRESS`/`PROVIDER_PRIVATE_KEY`, `FACILITATOR_ADDRESS`/`FACILITATOR_PRIVATE_KEY`, `EVALUATOR_ADDRESS`, `LEMMA_ALLOW_PROVISIONAL` (`false` by default), `LEMMA_TRUST_PROXY` (`true` behind Railway so rate limits use `X-Forwarded-For`), `LEMMA_MIGRATE_ON_START` (default on).

Each address must match its key or startup fails. Without the provider key, registry address, or facilitator key plus RPC URL, paid tools return `paid_tools_disabled` with the missing names; previews and read APIs keep working.

Never add private values to browser-prefixed variables or API responses.

## Workspace dependencies

- `@lemma/core` for shared schemas and identifiers.
- `@lemma/catalog` for curated releases and fixtures.
- Hono for HTTP routing.
- MCP and x402 SDKs for paid tools.
- viem for Arbitrum interactions.
- Drizzle and Postgres for persistence.

## Environment variables

Server work will eventually require `DATABASE_URL`, `PUBLIC_BASE_URL`, `ARBITRUM_SEPOLIA_RPC_URL`, provider and facilitator roles, the USDC address, and the deployed warranty registry address.

Never add private values to browser-prefixed variables or API responses.

## Development and tests

- `npm run dev -w @lemma/server` (tsx watch; in-memory storage unless `DATABASE_URL` is set)
- `npm run build -w @lemma/server`, then `node apps/server/dist/index.js`
- `npm run migrate -w @lemma/server` applies `migrations/*.sql` to `DATABASE_URL` (the server also migrates on start)
- `npm run test -w @lemma/server` or `npm test` from the root. Payment tests use a fake facilitator that checks the buyer's EIP-3009 signature offline. The Postgres tests start a throwaway Postgres 16 cluster from `/usr/lib/postgresql/16/bin` (override with `LEMMA_PG_BIN`) and skip when it is unavailable.
- `npm run e2e:fork -w @lemma/server` (not part of `npm test`): Anvil fork of Arbitrum Sepolia, registry deployed with `forge create`, real x402 settlement through the self-hosted facilitator, onchain activation, recovery and receipt. It uses only Anvil's public dev keys.

Tests require no environment values.

## Security constraints

- Validate every request with explicit schemas and size limits.
- Allow only the configured chain, token, payment scheme, amounts, and provider destination.
- Use parameterized database operations.
- Do not return internal stack traces in production.
- Apply restrictive CORS, rate limits, timeouts, and security headers.
- Store resolution identifiers as high-entropy values.
- Treat settlement timeout as an indeterminate state that requires reconciliation.
- Run a single facilitator replica until pending settlement state is moved to shared storage.

## Known gaps

- Settlement timeouts are not reconciled automatically. A facilitator that broadcast but timed out leaves the resolution `pending`, and a retry signs a new authorization. Single replica only: the purchase lock, the unrecorded-settlement retry map and the facilitator's pending-settlement store are all in process memory.
- No chain-event indexer yet. `chain_event_cursors` exists for it.
- Rate limiting is per process and fixed-window.
- `@x402/evm` 2.27.0 leaves its eager asset-contract `eth_getCode` promise unobserved when verification returns early; a failing RPC then produced an unhandled rejection that killed the process. The facilitator signer's `getCode` now retries and never rejects (verification fails closed instead), and the entry point logs any other unhandled rejection rather than exiting (`test/facilitator-rpc.test.ts`).

## Completion criteria

A remote MCP client can preview for free, settle one bounded x402 payment, recover the same resolution without paying again, obtain a provider-signed warranty voucher, and see the corresponding records through the read-only API. The test suite and the fork run both demonstrate this.

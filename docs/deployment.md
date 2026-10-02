# Deployment

## Target environment

- Arbitrum Sepolia, chain ID 421614.
- Arbitrum Sepolia USDC at `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`.
- One Railway application for server and dashboard assets.
- Railway Postgres for durable application state.
- One facilitator replica during the MVP.

## Role separation

Create distinct testnet identities for:

- Deployer and contract administrator.
- Capability provider and x402 recipient.
- Facilitator transaction signer.
- Outcome evaluator.
- Benchmark and pilot buyers.

Record public addresses. Keep private keys only in scoped local files or Railway secrets.

## Deployment order

1. Run all TypeScript and Foundry checks.
2. Deploy and verify the warranty registry with the expected USDC contract and roles.
3. Apply the database schema and record its version.
4. Configure the server with the verified registry address.
5. Deploy one Railway replica from `ops/Dockerfile`.
6. Verify facilitator supported kinds before enabling paid MCP tools.
7. Complete an unpaid preview, one successful payment, recovery, warranty activation, pass, and failure refund.
8. Publish only secret-free deployment evidence.

## Required production headers

The deployed server must enable HTTPS-only transport, Strict Transport Security, a restrictive Content Security Policy, MIME sniffing protection, frame denial, a strict referrer policy, and no-store caching on sensitive responses.

## Rollback

Pause new contract activations and disable paid tools if settlement, voucher signing, or accounting behaves unexpectedly. Preserve read-only resolution recovery and withdrawal access. Never delete evidence to make a failed deployment appear clean.

## Runtime note

The Docker image (`ops/Dockerfile`) builds every workspace and the Vite dashboard, then runs `node apps/server/dist/index.js` as a long-lived process on `PORT`. The same process serves the dashboard from `apps/web/dist`. On start it applies pending migrations from `apps/server/migrations` when `DATABASE_URL` is set (advisory-locked, idempotent; disable with `LEMMA_MIGRATE_ON_START=false` and use `npm run migrate -w @lemma/server` instead). `GET /health` returns `{ ok, version }`, with 503 when the database is unreachable. The image `HEALTHCHECK` and the Railway `healthcheckPath` both use it. Set `LEMMA_TRUST_PROXY=true` on Railway. Keep one replica.

Never test with Anvil's default dev keys on a real network. They are public, and on Arbitrum Sepolia those addresses already carry EIP-7702 delegation code from sweeper bots. The fork script clears that code locally.

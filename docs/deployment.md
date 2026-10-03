# Deployment

## Target environment

- Arbitrum Sepolia, chain ID 421614.
- Arbitrum Sepolia USDC at `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`.
- One Railway application for server and dashboard assets.
- Railway Postgres for durable application state.
- One facilitator replica during the MVP.

## Role separation

Create distinct testnet identities for:

- Deployer and contract administrator (`DEPLOYER_*`, registry `DEFAULT_ADMIN_ROLE`).
- Capability provider and x402 recipient (`PROVIDER_*`, also `LEMMA_PROVIDER_ADDRESS` for the bridge).
- Facilitator transaction signer (`FACILITATOR_*`).
- Outcome evaluator (`EVALUATOR_*`).
- Benchmark and pilot buyers (`BUYER_*`, `BENCHMARK_BUYER_*`).

Record public addresses. Keep private keys only in the gitignored `.env` or Railway secrets. The operator scripts read `.env` programmatically and never print values; do not `cat` it.

## Operator scripts

All scripts live in `scripts/` and run with `tsx` from the repository root. They load `<repo>/.env` (override with `--dotenv PATH`); exported variables win over the file.

| Command | Network | Sends transactions |
|---|---|---|
| `npm run demo:fork` | Anvil fork of Arbitrum Sepolia | fork only |
| `npm run testnet:setup -- --dry-run` | Arbitrum Sepolia | no (read-only) |
| `npm run testnet:setup -- --yes` | Arbitrum Sepolia | yes |
| `npm run demo:testnet` | Arbitrum Sepolia | no (read-only preflight) |
| `npm run demo:testnet -- --yes` | Arbitrum Sepolia | yes |
| `npm run evaluator -- status\|finalize\|expire ...` | any (`--rpc`) | only with `--yes` |

## Runbook (exact order)

### 0. Checks and rehearsal

```sh
export PATH=/root/.local/bin:$PATH        # forge/anvil
npm ci && git submodule update --init --recursive
npm run typecheck && npm test && npm run contracts:test
npm run demo:fork                         # full product flow on a fork, ~20 s
```

`demo:fork` runs the same setup code as `testnet:setup` (ETH top-ups, `forge script Deploy`, release registration, bonding) against an Anvil fork, then the production server entry on a throwaway Postgres, the real `lemma-mcp` bridge over stdio, and the evaluator CLI. It uses only Anvil's public dev keys. Its deployment record goes to `contracts/deployments/fork-421614.json` (gitignored), never `421614.json`. It must end with `DEMO PASSED`.

### 1. Fund the deployer

```sh
npm run testnet:setup -- --dry-run
```

Read-only. Prints every role's ETH and USDC, the gas price, the planned ETH top-ups, the deploy gas estimate, the registrations and bonds, and any blockers (exit code 2 when blocked). The deployer funds every other role, so only the deployer needs faucet ETH: the dry run prints the exact amount (about 0.011 ETH when every role is empty). Role addresses carrying contract code (EIP-7702 delegations) are reported as blockers. The provider needs 2 USDC for the default bonds.

### 2. Deploy, register, bond

```sh
npm run testnet:setup -- --yes            # optional: --bond 1.00, --registry 0x..., --redeploy
```

1. Tops up each role below its minimum from the deployer (provider 0.001, facilitator 0.003, evaluator 0.001, buyer 0.002, benchmark buyer 0.002 ETH).
2. Deploys `ResolutionWarrantyRegistry(USDC, admin = deployer)` with `forge script script/Deploy.s.sol:Deploy` (the key and RPC URL reach forge through the environment, not argv). The script fails closed on the wrong chain, token, or decimals.
3. Registers `x402-mcp-server@1.0.0` and `x402-mcp-client@1.0.0` with PROVIDER as provider, EVALUATOR as evaluator, the catalog price (0.12 USDC) and claim window (72 h).
4. Provider approves and deposits bond up to `--bond` (default 1 USDC) of available bond per release.
5. Writes `contracts/deployments/421614.json` (registry, deploy tx, block, domain separator, compiler, source commit, roles, releases with their registration and bond txs). It refuses to write if any role key would appear in it.
6. Prints the env lines to add and an optional `forge verify-contract` command.

Re-running is idempotent: an existing registry (from `--registry`, `RESOLUTION_WARRANTY_REGISTRY_ADDRESS`, or the record) is reused, registered releases are skipped after checking their terms, and bonds are only topped up.

### 3. Configure

Add to `.env` and to Railway secrets:

```
RESOLUTION_WARRANTY_REGISTRY_ADDRESS=<registry from step 2>
LEMMA_PROVIDER_ADDRESS=<provider address>     # bridge
```

Server: `DATABASE_URL`, `ARBITRUM_SEPOLIA_RPC_URL`, `RESOLUTION_WARRANTY_REGISTRY_ADDRESS`, `PROVIDER_ADDRESS/PRIVATE_KEY`, `FACILITATOR_ADDRESS/PRIVATE_KEY`, `EVALUATOR_ADDRESS`, `LEMMA_TRUST_PROXY=true`, and `LEMMA_ALLOW_PROVISIONAL=true` for the demo (both releases carry provisional evidence until the benchmark is frozen; without it previews are not purchasable). Never give the server the deployer or evaluator key.

### 4. Deploy the server

1. Deploy one Railway replica from `ops/Dockerfile`. Migrations apply on start.
2. `curl $URL/health` returns `{ ok: true }`; `curl $URL/api/v1/status` shows the registry, provider, facilitator, evaluator, `paidTools.enabled: true` and `provisionalOverride: true`.
3. `curl $URL/facilitator/supported` lists `exact` on `eip155:421614` before paid tools are announced.

### 5. Live end-to-end evidence

```sh
npm run demo:testnet                      # preflight, read-only
npm run demo:testnet -- --yes             # local server; or add --api https://<railway-url>
```

Runs the demo narrative on Arbitrum Sepolia with Arbiscan links: unpaid preview, one x402 payment settled by the facilitator, warranty activation, apply and acceptance, signed receipt, evaluator Passed, free no-match on the Python and Express fixtures, prepared failure with evaluator Failed, buyer credit and `withdrawCredit`. Cost per run: about 0.063 USDC from the buyer (0.005 + a 0.053 success fee for the passing gpt-5.6-terra resolution; the failure's 0.005 is returned from the provider bond) plus gas. Lost-response recovery and expiry are demonstrated on the fork (`demo:fork`); live, unresolved warranties are expired after 72 h with:

```sh
npm run evaluator -- expire --resolution 0x... --yes
```

### 6. Evaluator operations

```sh
npm run evaluator -- status   --resolution 0x...
npm run evaluator -- finalize --resolution 0x... --result passed|failed          # signs and checks only
npm run evaluator -- finalize --resolution 0x... --result failed --yes           # submits finalizeOutcome
npm run evaluator -- expire   --resolution 0x... --yes
```

`finalize` signs the EIP-712 `Outcome(resolutionId, result, evidenceDigest)` with `EVALUATOR_PRIVATE_KEY` using the `@lemma/core` typed data, checks it equals the registry's `hashOutcome`, checks the warranty is Active, inside its claim window, and that this key is the release evaluator, then submits `finalizeOutcome` from the evaluator wallet. Without `--evidence` it uses the buyer's latest Adoption Receipt evidence digest from `LEMMA_API_URL` (`--api`) and warns if the chosen result differs from the receipt's outcome. Options: `--registry`, `--rpc`, `--dotenv`, `--json`.

### 7. Publish evidence

Publish only secret-free evidence: `contracts/deployments/421614.json`, the transaction hashes and Arbiscan links printed by `demo:testnet`, and `/api/v1/resolutions/:id` summaries.

## Required production headers

The deployed server must enable HTTPS-only transport, Strict Transport Security, a restrictive Content Security Policy, MIME sniffing protection, frame denial, a strict referrer policy, and no-store caching on sensitive responses.

## Rollback

Pause new contract activations (`pause()` from the admin) and disable paid tools (unset `PROVIDER_PRIVATE_KEY`) if settlement, voucher signing, or accounting behaves unexpectedly. Preserve read-only resolution recovery and withdrawal access. Never delete evidence to make a failed deployment appear clean.

## Runtime note

The Docker image (`ops/Dockerfile`) builds every workspace and the Vite dashboard, then runs `node apps/server/dist/index.js` as a long-lived process on `PORT`. The same process serves the dashboard from `apps/web/dist`. On start it applies pending migrations from `apps/server/migrations` when `DATABASE_URL` is set (advisory-locked, idempotent; disable with `LEMMA_MIGRATE_ON_START=false` and use `npm run migrate -w @lemma/server` instead). `GET /health` returns `{ ok, version }`, with 503 when the database is unreachable. The image `HEALTHCHECK` and the Railway `healthcheckPath` both use it. Set `LEMMA_TRUST_PROXY=true` on Railway. Keep one replica.

Never test with Anvil's default dev keys on a real network. They are public, and on Arbitrum Sepolia those addresses already carry EIP-7702 delegation code from sweeper bots. The fork scripts clear that code locally.

The scripts start the server, bridge and evaluator CLI as child processes with an explicit environment: role variables plus the non-secret network settings (`HTTP(S)_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`, `NODE_OPTIONS`, `SSL_CERT_FILE`). `demo:testnet` preflight checks that a child process can reach the RPC. On failure both demo scripts keep their scratch directory and print the server exit status and the server and bridge log tails.

Fork runs and live runs both write `contracts/broadcast/Deploy.s.sol/421614/run-latest.json` (gitignored); `testnet-setup` copies the deploy transaction hash into the deployment record immediately after deploying.

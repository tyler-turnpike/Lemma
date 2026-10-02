# Demo Script

## Core line

Lemma stops coding agents from paying to rediscover solved integration work.

## Commands

- Rehearsal, no real funds: `npm run demo:fork` (Anvil fork of Arbitrum Sepolia, ~20 s, ends with `DEMO PASSED`).
- Live: `npm run testnet:setup -- --yes` once (see [deployment.md](deployment.md)), then `npm run demo:testnet -- --yes` (Arbiscan links).

Both print one narrated log, step-numbered as below, with balances, tx hashes and an end-of-run before/after table. Every buyer action goes through the real `lemma-mcp` bridge over stdio (the same way Cursor, Codex or Claude Code call it) against the real server; evaluator actions go through `scripts/evaluator.ts`.

The server runs with `LEMMA_ALLOW_PROVISIONAL=true`: both releases have provisional (not yet benchmarked) evidence, and the preview says so (`provisional override: YES`). Say this out loud.

## Three-minute sequence

| # | Beat | What runs | Log section |
|---|---|---|---|
| 1 | TypeScript MCP fixture; ask the agent to add x402 on Arbitrum Sepolia | temp copy of catalog fixture `mcp-server-exact`; bridge spawned with `LEMMA_WORKSPACE` on it | `[1]` |
| 2 | Agent calls `lemma_preview` before coding | bridge `lemma_preview { kind: "x402-paywall-mcp-server" }` builds the allowlisted profile and calls the server | `[2-3]` |
| 3 | Typed match, price, expected saving, limitations, warranty | preview fields: decision `reuse`, release, 0.12 USDC, coverage + 72 h window, evidence `provisional`, limitations, local policy verdict | `[2-3]` |
| 4 | Bridge checks its local cap and pays via x402 | `lemma_buy_resolution`: spend check (0.25 per resolution, 1.00 per day), guard on network/token/payTo/amount, EIP-3009 payment settled by the facilitator | `[4-5]` |
| 5 | Settlement tx and signed resolution | settlement tx (Arbiscan link live), payload digest and provider voucher signer verified, warranty activation tx; repeat buy returns `already-owned` with no second payment | `[4-5]` |
| 6 | Preview and apply the patch | `lemma_apply_resolution` dry run (file list + dependency additions), then `apply: true` | `[6]` |
| 7 | Acceptance recipe and Adoption Receipt | `lemma_verify_adoption`: 4 tests pass, buyer-signed receipt accepted; `/api/v1/adoption-receipts` lists it | `[7]` |
| 8 | Activated warranty and successful outcome | `npm run evaluator -- finalize --result passed --yes`: `Outcome(Passed)` signed by the EVALUATOR key, reserve released to the provider bond; dashboard summary | `[8]` |
| 9 | Incompatible fixture, free no-match | `python-service` and `express-no-mcp`: decision `decline`, no price, buy refused locally, 0 USDC spent | `[9]` |
| 10 | Prepared failure and bond refund | **prepared failure** workspace (its own vitest harness stubs `@x402/mcp`, so acceptance fails after a correct apply): buy, apply, failed receipt, `finalize --result failed --yes`, buyer credit 0.12, `withdrawCredit()`, buyer +0.12 USDC. On the fork this purchase's response is also dropped by an injected network fault and the bridge recovers it without paying twice | `[10]` |
| 11 | Frozen control and treatment benchmark | `GET /api/v1/benchmarks` status; the paired run is `npm run benchmark` (packages/benchmark) | `[11]` |
| A | (fork only) expiry | client release bought, chain time advanced 72 h, `npm run evaluator -- expire --yes`, reserve released | `[A]` |

## Claims to make

- Lemma sells verified applicability and integration execution, not ownership of open-source code.
- The agent pays only after a free compatibility preview.
- Spending policy is enforced outside the model.
- Eligible failure costs the provider bond.
- The benchmark measures all-in cost-to-green.

## Claims to avoid

- Do not call the MVP a decentralized correctness oracle.
- Do not claim a broad marketplace from one provider.
- Do not imply testnet USDC is production revenue.
- Do not describe receipts as proof of causal value without the paired benchmark.
- Do not hide the manual evaluator trust assumption.
- Do not present the step 10 failure as organic: it is staged and labelled `PREPARED FAILURE` in the log.

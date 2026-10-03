# Demo Script

## Core line

Lemma stops coding agents from paying to rediscover solved integration work.

## Commands

- Rehearsal, no real funds: `npm run demo:fork` (Anvil fork of Arbitrum Sepolia, ~20 s, ends with `DEMO PASSED`).
- Live: `npm run demo:testnet -- --yes --api https://lemma-production-8383.up.railway.app` against the hosted server (needs funded testnet role keys, see [deployment.md](deployment.md); prints Arbiscan links). It costs about 0.06 test USDC per run (0.005 + 0.053 kept by the provider, 0.005 refunded) plus gas. Run `npm run demo:testnet` first for the read-only preflight.

Both print one narrated log, step-numbered as below, with balances, tx hashes and an end-of-run before/after table. Every buyer action goes through the real `lemma-mcp` bridge over stdio (the same way Cursor, Codex or Claude Code call it after the one-command install on [/connect](https://lemma-production-8383.up.railway.app/connect)) against the real server; evaluator actions go through `scripts/evaluator.ts`.

The server runs with the provisional override off. The `1.1.0` releases are registered at 0.005 USDC, priced from the lemma-bench-v1 measurement, and sold only because they pass the 30% pricing rule; the preview says so (`provisional override: no: priced from measured evidence, sold under the 30% rule`).

The happy-path bridge declares `gpt-5.6-terra`, so its quote is `0.005 USDC now + 0.053 USDC only if the tests pass`: the registered price up front (warranty-covered), the rest as a success fee paid over x402 after the acceptance tests pass. The failure-path bridge declares no model (priced as `gpt-5.6-luna`), pays no fee, and gets its 0.005 refunded. The model is self-declared. Say this out loud.

## Three-minute sequence

| # | Beat | What runs | Log section |
|---|---|---|---|
| 1 | TypeScript MCP fixture; ask the agent to add x402 on Arbitrum Sepolia | temp copy of catalog fixture `mcp-server-exact`; bridge spawned with `LEMMA_WORKSPACE` on it | `[1]` |
| 2 | Agent calls `lemma_preview` before coding | bridge `lemma_preview { kind: "x402-paywall-mcp-server" }` builds the allowlisted profile and calls the server | `[2-3]` |
| 3 | Typed match, quote, expected saving, limitations, warranty | preview fields: decision `reuse`, release `x402-mcp-server@1.1.0`, price `0.005 USDC now + 0.053 USDC only if the tests pass` (quote for gpt-5.6-terra: 25% of the expected saving), coverage + 72 h window, evidence `benchmarked`, provisional override `no`, limitations, local policy verdict | `[2-3]` |
| 4 | Bridge checks its local cap and pays the up-front price via x402 | `lemma_buy_resolution`: spend check (0.25 per resolution, 1.00 per day), guard on network/token/payTo/amount, EIP-3009 payment settled by the facilitator | `[4-5]` |
| 5 | Settlement tx and signed resolution | settlement tx (Arbiscan link live), payload digest and provider voucher signer verified, warranty activation tx; repeat buy returns `already-owned` with no second payment | `[4-5]` |
| 6 | Preview and apply the patch | `lemma_apply_resolution` dry run (file list + dependency additions), then `apply: true` | `[6]` |
| 7 | Acceptance recipe, success fee and Adoption Receipt | `lemma_verify_adoption: acceptance recipe, success fee over x402, buyer-signed Adoption Receipt`: 4 tests pass, then the bridge pays the 0.053 USDC success fee over x402 (`lemma_pay_success_fee`) and submits the receipt; the server records the fee and `/api/v1/adoption-receipts` lists the receipt | `[7]` |
| 8 | Activated warranty and successful outcome | `npm run evaluator -- finalize --result passed --yes`: `Outcome(Passed)` signed by the EVALUATOR key, reserve released to the provider bond; dashboard summary | `[8]` |
| 9 | Incompatible fixture, free no-match | `python-service` and `express-no-mcp`: decision `decline`, no price, buy refused locally, 0 USDC spent | `[9]` |
| 10 | Prepared failure and bond refund | **prepared failure** workspace (its own vitest harness stubs `@x402/mcp`, so acceptance fails after a correct apply): buy (0.005 up front), apply, failed receipt, no success fee, `finalize --result failed --yes`, buyer credit 0.005, `withdrawCredit()`, buyer +0.005 USDC. On the fork this purchase's response is also dropped by an injected network fault and the bridge recovers it without paying twice | `[10]` |
| 11 | Frozen control and treatment benchmark | `GET /api/v1/benchmarks` status (lemma-bench-v3, validated); the paired run is `npm run benchmark` (packages/benchmark) | `[11]` |
| A | (fork only) expiry | client release bought, chain time advanced 72 h, `npm run evaluator -- expire --yes`, reserve released | `[A]` |

## Claims to make

- Lemma sells verified applicability and integration execution, not ownership of open-source code.
- The agent pays only after a free compatibility preview.
- Spending policy is enforced outside the model.
- Eligible failure costs the provider bond.
- The benchmark measures all-in cost-to-green. On Lemma's own fixtures, lemma-bench-v3 (gpt-5.6-luna, 3 reps per arm) met every pre-registered criterion: median all-in cost 58.5% lower, total tokens 78.3% fewer, 9/9 passes vs 7/9, 0 USDC on the no-match task. Say it is indicative, not statistically powered, and that v1 cost more at the provisional 0.12 USDC price before Lemma repriced.
- The price is a quote: a quarter of the measured saving scaled to the declared model, half a cent up front (warranty-covered), the rest only if the tests pass.

## Claims to avoid

- Do not call the MVP a decentralized correctness oracle.
- Do not claim a broad marketplace from one provider.
- Do not imply testnet USDC is production revenue.
- Do not describe receipts as proof of causal value without the paired benchmark.
- Do not claim proven savings in general: the benchmark is three tasks on Lemma's own fixtures with list-price cost estimates.
- Do not imply the declared model is verified: it is self-declared, and an unpaid success fee only marks the buyer delinquent.
- Do not hide the manual evaluator trust assumption.
- Do not present the step 10 failure as organic: it is staged and labelled `PREPARED FAILURE` in the log.

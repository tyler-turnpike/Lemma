# HackQuest Submission: Lemma

Arbitrum Open House Singapore online buildathon (HackQuest). Suggested track: **Promising Products** (AI agents and novel financial primitives); the project is also eligible for the Overall track.

| | |
|---|---|
| **Deadline** | **4 Oct 2026, 15:59 SGT = 13:29 IST (07:59 UTC)**. Aim to submit by 11:30 IST. |
| Demo video | 5:00 hard limit. The script in [video-script.md](video-script.md) targets 3:45 |
| Pitch video | 5:00 hard limit. The script targets 1:55, hard max 2:00 |
| Fundraising status | Not fundraising (confirmed by the team) |

Three placeholders are left for the team to fill, and nothing else: `[DEMO VIDEO URL]`, `[PITCH VIDEO URL]`, `[TEAM LEADER GITHUB]`. Every other fact below matches the live site at https://lemma-production-8383.up.railway.app as of 3 Oct 2026. The live testnet run and the benchmark are both done, so no sentence here is waiting on a result.

Each field below is ready to paste. Text inside the fenced blocks is the paste-ready version.

---

## Name

```
Lemma
```

## Intro (short tagline)

```
Coding agents buy verified, bonded integration fixes in USDC via x402 on Arbitrum, mostly paid on success.
```

(106 characters. A shorter alternative, 64 characters: `Bonded compatibility resolutions for coding agents, on Arbitrum.`)

## Description

```
Coding agents keep re-solving the same integration work. Adding x402 payments to an MCP server is open-source, solved work, yet every agent re-researches it, adapts it to the repository's pinned versions, debugs it, and pays for all of that in tokens and time. Open source makes code available. It does not tell the agent whether an implementation fits this repository, and when something prepackaged breaks, nobody is accountable.

Lemma sells that missing piece: a compatibility resolution with bonded recourse.

Before coding, the agent calls Lemma through a local MCP bridge, installed with one command or one click for Claude Code, Codex, Cursor, VS Code and Goose. The bridge sends an allowlisted repository profile, never source, and gets a free decision: reuse, adapt, or decline. A decline costs nothing. If a curated Capability Release fits, the preview quotes a price: a quarter of the saving Lemma measured, scaled to the agent's declared model. The bridge checks hard spending caps in code, outside the model, then pays the up-front part, half a cent of USDC, through the standard x402 "exact" scheme to Lemma's self-hosted facilitator on Arbitrum Sepolia. The server returns a deterministic patch, a pinned acceptance test, and an EIP-712 warranty voucher bound to the real settlement transaction. The bridge activates the voucher in our ResolutionWarrantyRegistry contract, which reserves provider bond for a 72-hour claim window, applies the patch atomically, and runs the test. Only if it passes does the bridge pay the rest of the quote as a success fee over x402 and sign an adoption receipt. If the evaluator confirms a failure, no fee is owed and the buyer withdraws the up-front price from the provider's bond. If the paid response is lost, the bridge recovers it without paying twice.

Why Arbitrum: the up-front price is half a cent, so settlement and warranty transactions have to cost far less than the thing being sold. x402 gives agents a standard way to pay. The registry adds the part x402 alone does not have, which is recourse after payment.

Honest status: this is a working testnet MVP with one first-party provider and two curated releases. The registry is deployed and both releases are bonded. The full flow, including real x402 settlement, the success fee, refund from bond, free no-match and recovery, passes end to end on an Arbitrum Sepolia fork. It has also run live on Arbitrum Sepolia, and the purchase is public on the hosted site: [live resolution record](https://lemma-production-8383.up.railway.app/resolutions/0xcfc9ba00d23811b57fbdf25b3883981da5c72c6ee574887c26cc856ccf7b14cc) with its [x402 settlement](https://sepolia.arbiscan.io/tx/0x279820c5c0b8abc0840c3f498a15e4fd86f4aef0a9d4f497ee49f1a2a5acd643) and [warranty activation](https://sepolia.arbiscan.io/tx/0x8743c7436ab46a6f1df2fb0a529d0191f9120d11983770189b2949e579ea2af5), plus an earlier failed adoption refunded from the provider bond ([bond refund](https://sepolia.arbiscan.io/tx/0x4ce2d7730211aa1e37604ed5adccc9803a35ec487379eed61c87887fed9bc1ce)). The evaluator is a trusted team key, not an oracle. The buyer's model is self-declared.

Benchmark: a frozen, paired Codex benchmark on gpt-5.6-luna, 20 runs, three repetitions per arm on our own fixtures. The first run (v1) cut tokens 75%, but all-in cost was 288% higher because the provisional 0.12 USDC price was 5.4x the measured saving. We repriced from that measurement to 0.005 USDC. A second run (v2) was stopped after 8 runs because of a payload defect; we fixed it, added a regression test and kept the records. The re-run, lemma-bench-v3, met every pre-registered criterion: median all-in cost 58.5% lower ($0.0403 vs $0.0167, including the price), 78.3% fewer tokens, 9/9 vs 7/9 passes, 42s vs 115s, and 0 USDC on the no-match task. Costs are list-price estimates, and three repetitions per arm are indicative, not statistically powered. v3 ran before success fees shipped; today's quote for that model adds 0.001 USDC on a pass, which is still 56% lower.
```

(About 590 words.)

## Progress During Buildathon

```
- 24 Sep 2026: Scaffolded the TypeScript monorepo (bridge, server, web, core, catalog, benchmark) and the Foundry contracts project. Wrote the architecture, economics, security model and benchmark protocol before writing product code.
- 2 Oct 2026: Built the first landing page (design tokens, hero, product mock, guarantees, footer).
- 2 Oct 2026: Implemented ResolutionWarrantyRegistry in Solidity: provider bonds, EIP-712 provider vouchers, evaluator outcomes, buyer credits, expiry, pause. Covered by unit, fuzz and invariant tests plus fixed EIP-712 vectors shared with TypeScript.
- 2 Oct 2026: Built core schemas, canonical hashing, spend policy and safe patch apply; a curated catalog of two x402 Capability Releases with exact, boundary and negative fixtures; and a deterministic resolver.
- 2 Oct 2026: Specified the bridge-to-server interface. Implemented the lemma-mcp local bridge: spend caps enforced in code, x402 payment guard, payload and voucher verification, on-chain warranty activation, lost-response recovery, signed adoption receipts.
- 2 Oct 2026: Implemented the hosted server: remote MCP with x402-paid purchase, a self-hosted x402 facilitator for Arbitrum Sepolia, Postgres persistence, and a read-only API.
- 2 Oct 2026: Added the dashboard views: catalog, resolution record, benchmark and status, with trust assumptions shown in the UI.
- 2 Oct 2026: Built the Codex SDK benchmark harness for a 20-run paired experiment. A smoke run passed acceptance.
- 2 Oct 2026: Scripted the whole product flow end to end (npm run demo:fork): real x402 settlement on an Arbitrum Sepolia fork, refund from bond, free no-match, recovery without double payment, and expiry. Prepared testnet operations.
- 2 Oct 2026: Deployed ResolutionWarrantyRegistry to Arbitrum Sepolia at 0x45Ae8799dF4C0878AD22CFe7040383F25f046d56. Registered both releases and bonded each with 1 USDC.
- 3 Oct 2026: Ran the frozen paired Codex benchmark (lemma-bench-v1, 9 matched runs per arm) and published the result as-measured: 75% fewer tokens, 9/9 vs 8/9 passes, 42s vs 96s median, but all-in cost 288% higher, because the provisional 0.12 USDC price was 5.4x the measured saving. The 25% cost target was not met, and the site said so and claimed no savings.
- 3 Oct 2026: Deployed the server and dashboard to https://lemma-production-8383.up.railway.app and completed a first live purchase on it (a 1.0.0 release at the old 0.12 USDC price, since superseded by the 1.1.0 purchase below).
- 3 Oct 2026: UI and brand pass on the landing page. Replaced the animated-ruler hero with a "Live on Arbitrum Sepolia" chip, the headline "Verified integrations for coding agents", a plain-English lede and three CTAs (see a live purchase, view on GitHub, install the bridge). Restored the green "L" Lemma mark (stem, mint band, arrow), the #5FE7BB mint accent and the tinted ink background, and added a mobile nav menu.
- 3 Oct 2026: Added three sections that turn claims into clickable evidence: a "Live proof" strip under the hero (registry address, featured settlement tx, resolution record, measured benchmark figures, and at the time the honest line that all-in cost was not yet lower); "How it works" (four live steps: free lemma_preview, capped x402 payment (then 0.12 USDC), atomic patch apply with pinned tests, on-chain activateResolution); and "Why Arbitrum" (cent-level payments, refunds enforced by contract, public receipts, each linking a real transaction or contract). Badged the product mock "Illustrative" and made it show the real settlement hash. Page order: hero, live proof, how it works, in use, guarantees, why Arbitrum, closing.
- 3 Oct 2026: Repriced from measured evidence. Registered x402-mcp-server@1.1.0 and x402-mcp-client@1.1.0 at 0.005 USDC (21.7% of the saving measured in v1, under the 30% pricing rule) with byte-identical payloads, and removed the provisional override, so nothing is sold that fails the rule. The 1.0.0 releases stay on chain but are no longer sold.
- 3 Oct 2026: Stopped lemma-bench-v2 after 8 runs and disclosed it: a relabelled comment in the 1.1.0 payloads made the acceptance test differ from the installed one, so every patch was refused. Fixed it with a regression test and kept the records.
- 3 Oct 2026: Re-ran the same frozen matrix as lemma-bench-v3 (20/20 runs, gpt-5.6-luna): verdict validated, all pre-registered criteria met. Median all-in cost 58.5% lower ($0.0403 vs $0.0167, including the 0.005 USDC price), total tokens 78.3% fewer (1,129,792 vs 245,045), 9/9 vs 7/9 passes, 41.9s vs 115.3s, 0 USDC on the no-match task. Costs are list-price estimates; three repetitions per arm on our own fixtures are indicative, not statistically powered. /benchmark shows the v3 verdict and the v1 to v3 series.
- 3 Oct 2026: Shipped per-request quotes. Each preview quotes 25% of the measured saving scaled to the agent's declared model (0.0005 USDC grid, capped at 0.25 USDC, never above the 30% rule). The registered 0.005 USDC is paid up front and is warranty-covered; the rest is a success fee paid over x402 (lemma_pay_success_fee) only after the acceptance tests pass. Examples for x402-mcp-server@1.1.0: gpt-5.6-luna 0.005 + 0.001, gpt-5.6-terra 0.005 + 0.053, gpt-5.5 0.005 + 0.1395. A passed receipt without the fee marks the buyer delinquent. No contract change. The landing page has a Pricing section with a model picker.
- 3 Oct 2026: Added one-command connect: a /connect page with one-click install for Cursor, VS Code and Goose and copy commands for Claude Code and Codex. The bridge bundle is self-hosted by the Lemma server (no npm publish), needs no environment variables, creates a testnet burner wallet in ~/.lemma/wallet.json on first run, and adds a lemma_wallet tool for address, balances and faucet links.
- 3 Oct 2026: Completed a live 1.1.0 purchase on the hosted server, now the featured resolution: [0xcfc9ba00…](https://lemma-production-8383.up.railway.app/resolutions/0xcfc9ba00d23811b57fbdf25b3883981da5c72c6ee574887c26cc856ccf7b14cc) (0.005 USDC settled, warranty activated on chain, 4/4 acceptance tests passed, 3 files). It predates success fees, so it carries none.
- 3 Oct 2026: Site fixes: removed stale prices, the catalog shows only 1.1.0 on sale with 1.0.0 under "Earlier versions (not sold)", Resolutions joined the main nav, the Live proof strip shows the v3 figures, plus accessibility, SEO and response compression fixes.
- Current: 357 TypeScript tests and 73 Foundry tests passing. Live on Arbitrum Sepolia: [featured settlement](https://sepolia.arbiscan.io/tx/0x279820c5c0b8abc0840c3f498a15e4fd86f4aef0a9d4f497ee49f1a2a5acd643) · [warranty activation](https://sepolia.arbiscan.io/tx/0x8743c7436ab46a6f1df2fb0a529d0191f9120d11983770189b2949e579ea2af5) · [bond refund](https://sepolia.arbiscan.io/tx/0x4ce2d7730211aa1e37604ed5adccc9803a35ec487379eed61c87887fed9bc1ce) · [registry](https://sepolia.arbiscan.io/address/0x45Ae8799dF4C0878AD22CFe7040383F25f046d56). Hosted site: https://lemma-production-8383.up.railway.app. Connect an agent: https://lemma-production-8383.up.railway.app/connect.
```

## Tech stack

The form allows up to 8, but only four options truthfully describe this project. Pick these four and leave the rest empty:

| Pick | Why |
|---|---|
| **Solidity** | `ResolutionWarrantyRegistry` (OpenZeppelin AccessControl, EIP712, Pausable, ReentrancyGuard), built and tested with Foundry |
| **Web3** | x402 USDC payments (EIP-3009), EIP-712 vouchers and outcomes, on-chain bond and warranty on Arbitrum Sepolia |
| **Node** | Hono server, self-hosted x402 facilitator, `lemma-mcp` stdio bridge, operator scripts, Codex SDK benchmark |
| **React** | Landing page and dashboard (React with Vite), including the Live proof strip that reads the live `/api/v1` status and benchmark |

Do not pick these:

- **Ethers.** We use viem, not ethers.js. A judge who opens the code would see the mismatch.
- **Next.** The web app is Vite, not Next.js.
- **Python.** It only appears as a negative fixture that Lemma declines.
- **Vue, Java, Go, Rust, Move.** Not used.

If the form forces more picks, add nothing rather than something inaccurate. List the rest in the description or the README instead: TypeScript, viem, x402, MCP, Foundry, Hono, Postgres, OpenAI Codex SDK.

## Category (up to 3)

The category options were not provided. Pick the closest matches to these, in this order:

1. **AI / Agents.** The buyer is a coding agent, and the product is an MCP tool.
2. **Payments / DeFi.** x402 USDC micropayments, a self-hosted facilitator, and on-chain bond and refunds.
3. **Infrastructure / Developer Tooling.** A local MCP bridge for Codex, Cursor, Claude Code, VS Code and Goose (one-command or one-click install), with a warranty registry.

## Fundraising status

```
Not fundraising
```

## Demo video

```
[DEMO VIDEO URL]
```

Script and shot list: [video-script.md](video-script.md), part A.

## Pitch video

```
[PITCH VIDEO URL]
```

Script: [video-script.md](video-script.md), part B.

## Team leader GitHub

```
[TEAM LEADER GITHUB]
```

Repository: https://github.com/tyler-turnpike/Lemma

---

## Pre-submit checklist

- [ ] Nothing says or implies: decentralized correctness oracle, marketplace, revenue, or proven savings.
- [ ] The evaluator is described as a trusted team key wherever it appears.
- [ ] The demo video shows the `PREPARED FAILURE` label and says out loud that the failure is staged.
- [ ] Both videos are under 5:00 and their links are public or unlisted, not private.
- [ ] The benchmark is reported as lemma-bench-v3, validated, everywhere: 58.5% lower median all-in cost, 78.3% fewer tokens, 9/9 vs 7/9, 0 USDC on no-match, on Lemma's own fixtures and indicative, not statistically powered. The v1 history (cost 288% higher at the provisional 0.12 USDC price, then repricing) and the stopped v2 are disclosed. Nothing claims savings in general.
- [ ] Current pricing is described as a per-request quote: 0.005 USDC up front (warranty-covered), the rest as a success fee only after the tests pass. No "twelve cents", "0.12" or "few cents" claim about the current price.
- [ ] The only resolution page linked anywhere is 0xcfc9ba00…; the superseded 1.0.0 purchase 0x62206062… is not featured, and the old 0x7923e77a… resolution is not on the hosted server and is never linked as a page.
- [ ] The repository is public, or judges have access.
- [ ] Submitted before 4 Oct 2026, 15:59 SGT = 13:29 IST = 07:59 UTC.

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
Coding agents buy verified, bonded integration fixes for cents in USDC via x402 on Arbitrum.
```

(92 characters. A shorter alternative, 64 characters: `Bonded compatibility resolutions for coding agents, on Arbitrum.`)

## Description

```
Coding agents keep re-solving the same integration work. Adding x402 payments to an MCP server is open-source, solved work, yet every agent re-researches it, adapts it to the repository's pinned versions, debugs it, and pays for all of that in tokens and time. Open source makes code available. It does not tell the agent whether an implementation fits this repository, and when something prepackaged breaks, nobody is accountable.

Lemma sells that missing piece: a compatibility resolution with bonded recourse.

Before coding, the agent calls Lemma through a local MCP bridge (works with Codex, Cursor and Claude Code). The bridge sends an allowlisted repository profile, never source, and gets a free decision: reuse, adapt, or decline. A decline costs nothing. If a curated Capability Release fits, the bridge checks hard spending caps in code, outside the model, and then pays a few cents of USDC through the standard x402 "exact" scheme to Lemma's self-hosted facilitator on Arbitrum Sepolia. The server returns a deterministic patch, a pinned acceptance test, and an EIP-712 warranty voucher bound to the real settlement transaction. The bridge activates the voucher in our ResolutionWarrantyRegistry contract, which reserves provider bond for a 72-hour claim window. It then applies the patch atomically, runs the test, and signs an adoption receipt. If the evaluator confirms a failure, the buyer withdraws a refund from the provider's bond. If the paid response is lost, the bridge recovers it without paying twice.

Why Arbitrum: per-resolution prices are cents, so settlement and warranty transactions have to cost far less than the thing being sold. x402 gives agents a standard way to pay. The registry adds the part x402 alone does not have, which is recourse after payment.

Honest status: this is a working testnet MVP with one first-party provider and two curated releases. The registry is deployed and both releases are bonded. The full flow, including real x402 settlement, refund from bond, free no-match and recovery, passes end to end on an Arbitrum Sepolia fork. It has also run live on Arbitrum Sepolia, and the purchase is public on the hosted site: [live resolution record](https://lemma-production-8383.up.railway.app/resolutions/0x62206062a3d206a012817992812e8cee0b5b05d7e885b3e4c347db23dbb7fdb2) with its [x402 settlement](https://sepolia.arbiscan.io/tx/0x7e8d2c2f4c69cb65121f70d948382624a7e041cd5bbedc4b12a387dc1305a381), plus a failed adoption refunded from the provider bond ([bond refund](https://sepolia.arbiscan.io/tx/0x4ce2d7730211aa1e37604ed5adccc9803a35ec487379eed61c87887fed9bc1ce)). The evaluator is a trusted team key, not an oracle. We ran a frozen, paired Codex benchmark (20 runs; 9 matched runs per arm): with Lemma, agents used 74.9% fewer tokens (shown as 75% on the site) and finished faster, 42s vs 96s median, with 9/9 vs 8/9 passes, but the 0.12 USDC price made all-in cost 288% higher on a very cheap model, so the 25% cost target was missed and we claim no savings. Pricing has to scale with the model cost it replaces.
```

(About 370 words.)

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
- 3 Oct 2026: Ran the frozen paired Codex benchmark (lemma-bench-v1, 9 matched runs per arm) and published the result as-measured: 75% fewer tokens, 9/9 vs 8/9 passes, 42s vs 96s median, but all-in cost 288% higher. The 25% cost target was not met, so the site claims no savings and says so on the landing page, the catalog and /benchmark.
- 3 Oct 2026: Deployed the server and dashboard to https://lemma-production-8383.up.railway.app and completed a live purchase on it, now the featured resolution: [0x62206062…](https://lemma-production-8383.up.railway.app/resolutions/0x62206062a3d206a012817992812e8cee0b5b05d7e885b3e4c347db23dbb7fdb2) (settled, warranty voucher signed, adoption receipt passed).
- 3 Oct 2026: UI and brand pass on the landing page. Replaced the animated-ruler hero with a "Live on Arbitrum Sepolia" chip, the headline "Verified integrations for coding agents", a plain-English lede and three CTAs (see a live purchase, view on GitHub, install the bridge). Restored the green "L" Lemma mark (stem, mint band, arrow), the #5FE7BB mint accent and the tinted ink background, and added a mobile nav menu.
- 3 Oct 2026: Added three sections that turn claims into clickable evidence: a "Live proof" strip under the hero (registry address, featured settlement tx, resolution record, measured benchmark figures, and the honest line that all-in cost is not yet lower); "How it works" (four live steps: free lemma_preview, capped x402 payment of 0.12 USDC, atomic patch apply with pinned tests, on-chain activateResolution); and "Why Arbitrum" (cent-level payments, refunds enforced by contract, public receipts, each linking a real transaction or contract). Badged the product mock "Illustrative" and made it show the real settlement hash. Page order: hero, live proof, how it works, in use, guarantees, why Arbitrum, closing.
- Current: 282 TypeScript tests and 73 Foundry tests passing. Live on Arbitrum Sepolia: [featured settlement](https://sepolia.arbiscan.io/tx/0x7e8d2c2f4c69cb65121f70d948382624a7e041cd5bbedc4b12a387dc1305a381) · [bond refund](https://sepolia.arbiscan.io/tx/0x4ce2d7730211aa1e37604ed5adccc9803a35ec487379eed61c87887fed9bc1ce) · [registry](https://sepolia.arbiscan.io/address/0x45Ae8799dF4C0878AD22CFe7040383F25f046d56). Hosted site: https://lemma-production-8383.up.railway.app.
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
3. **Infrastructure / Developer Tooling.** A local MCP bridge for Codex, Cursor and Claude Code, with a warranty registry.

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
- [ ] The benchmark is reported as-measured everywhere: 75% fewer tokens, 9/9 vs 8/9, all-in cost 288% higher, 25% cost target not met, no savings claimed.
- [ ] The only resolution page linked anywhere is 0x62206062…; the old 0x7923e77a… resolution is not on the hosted server and is never linked as a page.
- [ ] The repository is public, or judges have access.
- [ ] Submitted before 4 Oct 2026, 13:30 UTC.

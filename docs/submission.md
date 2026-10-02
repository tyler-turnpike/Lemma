# HackQuest Submission: Lemma

Arbitrum Open House London online buildathon (HackQuest), Solidity track.

| | |
|---|---|
| **Deadline** | **4 Oct 2026, 19:00 IST (13:30 UTC)** |
| Demo video | 5:00 hard limit. The script in [video-script.md](video-script.md) targets 3:30 to 4:00 |
| Pitch video | 5:00 hard limit. The script targets 2:00 or less |
| Fundraising status | Not fundraising (confirmed by the team) |

Before submitting, replace every placeholder: `[LIVE URL]`, `[live x402 settlement](https://sepolia.arbiscan.io/tx/0x38e6c25b7b690e61d6de9a3ab533d7a08d71f2e0f62bdf26ae35d887d4a4f869)`, `[BENCHMARK RESULT]`, `[DEMO VIDEO URL]`, `[PITCH VIDEO URL]`, `[TEAM LEADER GITHUB]`. If the live testnet run or the benchmark is not finished by the deadline, delete the sentence that holds the placeholder instead of guessing a value.

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

Honest status: this is a working testnet MVP with one first-party provider and two curated releases. The registry is deployed and both releases are bonded. The full flow, including real x402 settlement, refund from bond, free no-match and recovery, passes end to end on an Arbitrum Sepolia fork. It has also run live on Arbitrum Sepolia: [live x402 settlement](https://sepolia.arbiscan.io/tx/0x38e6c25b7b690e61d6de9a3ab533d7a08d71f2e0f62bdf26ae35d887d4a4f869), plus a failed adoption refunded from the provider bond ([bond refund](https://sepolia.arbiscan.io/tx/0x4ce2d7730211aa1e37604ed5adccc9803a35ec487379eed61c87887fed9bc1ce)). The evaluator is a trusted team key, not an oracle. A paired Codex benchmark (control vs. Lemma, 20 runs) is built, and we make no savings claim until it has run: [BENCHMARK RESULT].
```

(About 370 words.)

## Progress During Buildathon

```
- 24 Sep 2026: Scaffolded the TypeScript monorepo (bridge, server, web, core, catalog, benchmark) and the Foundry contracts project. Wrote the architecture, economics, security model and benchmark protocol before writing product code.
- 2 Oct 2026: Built the landing page (design tokens, hero, product mock, guarantees, footer).
- 2 Oct 2026: Implemented ResolutionWarrantyRegistry in Solidity: provider bonds, EIP-712 provider vouchers, evaluator outcomes, buyer credits, expiry, pause. Covered by unit, fuzz and invariant tests plus fixed EIP-712 vectors shared with TypeScript.
- 2 Oct 2026: Built core schemas, canonical hashing, spend policy and safe patch apply; a curated catalog of two x402 Capability Releases with exact, boundary and negative fixtures; and a deterministic resolver.
- 2 Oct 2026: Specified the bridge-to-server interface. Implemented the lemma-mcp local bridge: spend caps enforced in code, x402 payment guard, payload and voucher verification, on-chain warranty activation, lost-response recovery, signed adoption receipts.
- 2 Oct 2026: Implemented the hosted server: remote MCP with x402-paid purchase, a self-hosted x402 facilitator for Arbitrum Sepolia, Postgres persistence, and a read-only API.
- 2 Oct 2026: Added the dashboard views: catalog, resolution record, benchmark and status, with trust assumptions shown in the UI.
- 2 Oct 2026: Built the Codex SDK benchmark harness for a 20-run paired experiment. A smoke run passed acceptance.
- 2 Oct 2026: Scripted the whole product flow end to end (npm run demo:fork): real x402 settlement on an Arbitrum Sepolia fork, refund from bond, free no-match, recovery without double payment, and expiry. Prepared testnet operations.
- 2 Oct 2026: Deployed ResolutionWarrantyRegistry to Arbitrum Sepolia at 0x45Ae8799dF4C0878AD22CFe7040383F25f046d56. Registered both releases and bonded each with 1 USDC.
- Current: 282 TypeScript tests and 73 Foundry tests passing. Live testnet purchase: [live x402 settlement](https://sepolia.arbiscan.io/tx/0x38e6c25b7b690e61d6de9a3ab533d7a08d71f2e0f62bdf26ae35d887d4a4f869). Hosted dashboard: [LIVE URL].
```

## Tech stack

The form allows up to 8, but only four options truthfully describe this project. Pick these four and leave the rest empty:

| Pick | Why |
|---|---|
| **Solidity** | `ResolutionWarrantyRegistry` (OpenZeppelin AccessControl, EIP712, Pausable, ReentrancyGuard), built and tested with Foundry |
| **Web3** | x402 USDC payments (EIP-3009), EIP-712 vouchers and outcomes, on-chain bond and warranty on Arbitrum Sepolia |
| **Node** | Hono server, self-hosted x402 facilitator, `lemma-mcp` stdio bridge, operator scripts, Codex SDK benchmark |
| **React** | Landing page and dashboard (React with Vite) |

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

- [ ] `[LIVE URL]`, `[live x402 settlement](https://sepolia.arbiscan.io/tx/0x38e6c25b7b690e61d6de9a3ab533d7a08d71f2e0f62bdf26ae35d887d4a4f869)` and `[BENCHMARK RESULT]` are replaced or their sentences deleted, here and in README.md.
- [ ] Nothing says or implies: decentralized correctness oracle, marketplace, revenue, or proven savings.
- [ ] The evaluator is described as a trusted team key wherever it appears.
- [ ] The demo video shows the `PREPARED FAILURE` label and says out loud that the failure is staged.
- [ ] Both videos are under 5:00 and their links are public or unlisted, not private.
- [ ] The repository is public, or judges have access.
- [ ] Submitted before 4 Oct 2026, 13:30 UTC.

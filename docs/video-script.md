# Video Scripts

Two videos for the HackQuest submission. The hard limit for each is 5:00. Deadline: **4 Oct 2026, 15:59 SGT = 13:29 IST (07:59 UTC)**.

- **A. Demo video:** targets 3:45, hard max 5:00. Product walkthrough on the live site, the terminal flow, and on-chain evidence.
- **B. Pitch video:** targets 1:55, hard max 2:00. Problem, solution, why Arbitrum and x402, honest traction, ask.

Narration runs at about 150 words per minute. Read it calmly. If a beat runs long, cut words rather than speeding up. Keep the claims inside [demo-script.md](demo-script.md), "Claims to avoid": no oracle, no marketplace, testnet is not revenue, receipts are not proof of savings, the benchmark is indicative and on Lemma's own fixtures (never "proven savings" in general), the evaluator is a trusted team key, and the refund failure in the demo is staged.

All placeholders are filled.

---

## A. Demo video (target 3:45)

### Before recording

1. Use a large terminal font (at least 18 pt), a dark theme, and a window of about 120 columns. Browser at a 1440-wide window, no bookmarks bar, no extensions.
2. Pick one terminal path:
   - **Live path (preferred if the testnet run works):** `npm run demo:testnet` (read-only preflight) must show no blockers. Record `npm run demo:testnet -- --yes --api https://lemma-production-8383.up.railway.app`. It prints Arbiscan links. It spends about 0.06 test USDC per run (0.005 + 0.053 kept by the provider, 0.005 refunded) plus gas.
   - **Fork path (always works, no secrets):** record `npm run demo:fork`. It prints the same numbered narrative on an Anvil fork. Fork tx hashes are not on Arbiscan, so lean on the real registry, settlement and refund transactions in shot 14 instead.
3. Either demo finishes in seconds to a few minutes, faster than the narration. Capture the output and scroll through it while narrating:
   ```bash
   npm run build                                   # once, so the recording skips the compile
   npm run demo:fork 2>&1 | tee /tmp/lemma-demo.log
   # or: npm run demo:testnet -- --yes --api https://lemma-production-8383.up.railway.app 2>&1 | tee /tmp/lemma-demo.log
   less -R /tmp/lemma-demo.log                     # scroll section by section: [1], [2-3] ... [summary]
   ```
   Record the live command running (shot 7) and use `less` for the walkthrough (shots 8 to 13).
4. Open these browser tabs, in this order:
   1. `https://lemma-production-8383.up.railway.app/` — hero, the Live proof strip, How it works, and the Pricing section with its model picker
   2. `https://lemma-production-8383.up.railway.app/resolutions/0xcfc9ba00d23811b57fbdf25b3883981da5c72c6ee574887c26cc856ccf7b14cc` — the featured live resolution (this is what "See a live purchase" links to)
   3. `https://lemma-production-8383.up.railway.app/connect` — one-click install buttons and copy commands
   4. `https://lemma-production-8383.up.railway.app/catalog` — 1.1.0 on sale (price, bond, 72 h window), 1.0.0 under "Earlier versions (not sold)"
   5. `https://lemma-production-8383.up.railway.app/benchmark` — the v3 verdict "Validated" and the Series history
   6. `https://lemma-production-8383.up.railway.app/status` — trust assumptions
   7. `https://sepolia.arbiscan.io/address/0x45Ae8799dF4C0878AD22CFe7040383F25f046d56` — warranty registry
   8. `https://sepolia.arbiscan.io/tx/0x279820c5c0b8abc0840c3f498a15e4fd86f4aef0a9d4f497ee49f1a2a5acd643` — the featured settlement tx (0.005 USDC)
   9. `https://sepolia.arbiscan.io/tx/0x8743c7436ab46a6f1df2fb0a529d0191f9120d11983770189b2949e579ea2af5` — the featured warranty activation tx
   10. `https://sepolia.arbiscan.io/tx/0x4ce2d7730211aa1e37604ed5adccc9803a35ec487379eed61c87887fed9bc1ce` — a real bond refund (an earlier failed adoption, at the old 0.12 price)
   11. `https://sepolia.arbiscan.io/tx/0xa015c0cc368327f674f4f0954816b6ccc6154a384d73c61ae41ab0105173cc42` — registry deploy tx

   The only resolution page to show is `0xcfc9…`. Do not open the old `/resolutions/0x62206062…` page: it is a superseded 1.0.0 purchase at the old price. Never open `/resolutions/0x7923e77a…`: that resolution only ever existed in a local database and the hosted page says "Resolution not found".

   The featured purchase predates success fees, so its page shows the 0.005 USDC payment and no fee. That is expected; the success fee appears in the terminal beats.

   If `https://lemma-production-8383.up.railway.app` is down, run the server locally with the registry environment and use `http://localhost:3000` instead. If that is not possible either, drop shots 1 to 6 and 15 and give their time to the terminal walkthrough plus Arbiscan.

### Shot list and narration

| Time | Shot | On screen |
|---|---|---|
| 0:00 to 0:16 | 1. Hero | Landing page: "● Live on Arbitrum Sepolia" chip, h1 "Verified integrations / for coding agents", the lede, three CTAs, nav CTA "Connect your agent" |
| 0:16 to 0:36 | 2. Live proof | The strip under the hero: registry address, featured settlement tx, resolution record, then 78% fewer tokens / 9-of-9 vs 7-of-9 / 42s vs 115s / "All-in cost 58% lower" |
| 0:36 to 0:45 | 3. Live purchase | Click "See a live purchase" → the featured resolution page `0xcfc9…`: 0.005 USDC payment, warranty voucher, adoption receipt passed (4/4 tests) |
| 0:45 to 0:52 | 4. How it works | The four steps with their mint "Live" badges: `lemma_preview`, x402 0.005 USDC ≤ cap, patch + pinned tests, `activateResolution(voucher)` |
| 0:52 to 1:11 | 5. Pricing | The Pricing section: switch the model picker from gpt-5.6-luna to gpt-5.6-terra; "Up front" 0.005, "On success" 0.053 |
| 1:11 to 1:21 | 6. Connect | `/connect`: the Cursor, VS Code and Goose buttons, then the Claude Code and Codex copy commands |
| 1:21 to 1:28 | 7. Run | Terminal: type and run the demo command; let the banner and setup lines appear |
| 1:28 to 1:49 | 8. Preview | Log `[1]` and `[2-3]`: fixture workspace, bridge tools, decision `reuse`, price line "0.005 USDC now + 0.053 USDC only if the tests pass (quote for gpt-5.6-terra …)", warranty, `provisional override: no: priced from measured evidence, sold under the 30% rule`, policy verdict |
| 1:49 to 2:09 | 9. Pay | Log `[4-5]`: spend check, x402 settlement tx (0.005), digest and voucher signer verified, warranty activation tx, repeat buy returns `already-owned` |
| 2:09 to 2:23 | 10. Apply and verify | Log `[6]`, `[7]`, `[8]`: dry-run file list, apply, 4 acceptance tests pass, `success fee: 0.053 USDC paid over x402`, receipt accepted, evaluator `Passed` |
| 2:23 to 2:33 | 11. No-match | Log `[9]`: `python-service` and `express-no-mcp` get `decline`, no price, buy refused, 0 USDC |
| 2:33 to 2:56 | 12. Refund | Log `[10]`: the `PREPARED FAILURE` note on screen, failed receipt, no success fee, evaluator `Failed`, buyer credit 0.005, `withdrawCredit`. Fork only: dropped response recovered with no second payment |
| 2:56 to 3:00 | 13. Summary | Log `[summary]` balance table and `DEMO PASSED` |
| 3:00 to 3:15 | 14. Why Arbitrum | Site "Why Arbitrum" section (three cards), then Arbiscan: registry, the featured settlement tx, the bond refund tx |
| 3:15 to 3:36 | 15. Benchmark and status | `/benchmark`: verdict "Validated", 58.5% lower all-in cost, 78.3% fewer tokens, 9/9 vs 7/9, then the Series list (v3 current, v2 stopped, v1 set the price). Then `/status` trust assumptions |
| 3:36 to 3:45 | 16. Close | Back to the hero, or the README deployment table on GitHub |

### Narration (word for word, about 560 words)

**[1] 0:00 Hero**

> This is Lemma: verified integrations for coding agents, live on Arbitrum Sepolia. Agents keep re-solving solved integration work and billing you the tokens. Lemma lets an agent ask first whether a verified patch fits, and buy it with a bonded warranty.

**[2] 0:16 Live proof**

> Everything on this strip is real and clickable: the warranty registry, the settlement of a real half-cent purchase, and its resolution record. Then the benchmark: seventy-eight percent fewer tokens, nine of nine passes against seven of nine, forty-two seconds instead of a hundred and fifteen, and all-in cost fifty-eight percent lower.

**[3] 0:36 Live purchase**

> Here's that purchase: the x402 payment, the provider-signed warranty voucher, and the buyer's adoption receipt, four tests passed. Testnet USDC, on Arbiscan.

**[4] 0:45 How it works**

> Four steps, all live: free preview, capped x402 payment, patch with pinned tests, bonded warranty on chain.

**[5] 0:52 Pricing**

> Prices come from that measurement. Each quote is a quarter of the measured saving, scaled to the agent's model. Half a cent is paid up front and covered by the warranty; the rest only if the tests pass. A pricier model pays more because it saves more.

**[6] 1:11 Connect**

> Connecting is one click in Cursor, VS Code or Goose, or one command in Claude Code or Codex. The bridge makes its own testnet wallet.

**[7] 1:21 Run**

> Now the whole flow in one script, through our real MCP bridge, the way a coding agent calls it.

**[8] 1:28 Preview**

> The task: add x402 payments to a TypeScript MCP server. Before coding, the agent calls lemma preview, sending only manifest and lockfile metadata, never source. Free answer: reuse. This agent declares a pricier model, so the quote is half a cent now, plus five point three cents only if the tests pass.

**[9] 1:49 Pay**

> The agent buys. Caps are enforced in code, outside the model: twenty-five cents per resolution, a dollar a day, plus recipient and amount checks. It pays the half cent over standard x402, verifies the digest and the provider's signature, and activates the warranty on chain. Buying again doesn't pay again.

**[10] 2:09 Apply and verify**

> It applies the patch and runs the pinned test. Four tests pass, so now it pays the success fee over x402. The buyer signs an adoption receipt, and our evaluator, a team-operated key, signs Passed.

**[11] 2:23 No-match**

> If nothing fits, Lemma says so for free. A Python service and an Express app with no MCP server both get decline. Zero USDC.

**[12] 2:33 Refund**

> This failure is staged: the harness is rigged to fail after a correct apply, and the log labels it prepared failure. No success fee. The evaluator signs Failed, and the half cent paid up front is refunded from the provider bond, on chain. On the fork we also drop the paid response; the bridge recovers it without paying twice.

**[13] 2:56 Summary**

> The balance table shows where every cent went. Demo passed.

**[14] 3:00 Why Arbitrum**

> Does this need a chain? Here, yes. A half-cent payment settles for a fraction of a cent of gas. Refunds are enforced by the contract, not by us; here's a real one. Every receipt is public.

**[15] 3:15 Benchmark and status**

> The benchmark page keeps the whole series. Our first run cut tokens but cost more, because the price was over five times the saving. We repriced from that measurement, and the re-run met every pre-registered criterion. That's three tasks on our own fixtures: indicative, not proof in general. Status: testnet only, team evaluator key.

**[16] 3:36 Close**

> That's Lemma: pay mostly when it works, with recourse when it doesn't. It's live, and open in the repo.

---

## B. Pitch video (target 1:55, hard max 2:00)

Format: talking head, or voice over five simple slides. About 280 words.

| Time | Slide or shot |
|---|---|
| 0:00 to 0:21 | Problem: an agent burning tokens on a familiar integration |
| 0:21 to 1:00 | Solution: the landing page "How it works" four steps, then the Pricing section |
| 1:00 to 1:20 | Why Arbitrum and x402: the registry on Arbiscan, the "Why Arbitrum" cards |
| 1:20 to 1:45 | Where we are: the Live proof strip, the featured resolution page, `/benchmark` Series, `/status` |
| 1:45 to 1:52 | Ask: `/connect`, repo URL and `https://lemma-production-8383.up.railway.app` |

### Narration (word for word, about 280 words)

**0:00 Problem**

> Coding agents are getting good, but they're expensive in a specific way: they keep re-solving work that's already solved. Adding payments to an MCP server is open source. Every agent still researches it, adapts it, debugs it, and bills you the tokens. And when something prepackaged doesn't fit, you have no recourse.

**0:21 Solution**

> Lemma is a compatibility layer for coding agents. Before coding, the agent asks Lemma, through a local MCP bridge, whether verified prior work fits this repository. The answer is free. If it fits, the bridge pays half a cent of USDC over x402, applies a tested patch, and runs a pinned test; the rest of the price, a quarter of the measured saving, is paid only if the test passes. If an evaluator confirms a failure, the buyer is refunded from the provider's bond. Spending caps are enforced in code, and your source never leaves your machine.

**1:00 Why Arbitrum and x402**

> x402 gives agents a standard way to pay for a tool call. What it doesn't give is recourse after payment. Our warranty registry on Arbitrum adds that: bonds, signed vouchers, refunds, all public on Arbiscan. At half a cent up front, settlement and warranty have to cost a fraction of that.

**1:20 Where we are**

> Lemma is a working testnet MVP on Arbitrum Sepolia, with one first-party provider and a team evaluator key. You can click through a real purchase on the site. Our first benchmark cut tokens but cost more at a provisional price. We repriced from that measurement, and the re-run lowered all-in cost fifty-eight percent and tokens seventy-eight percent, on our own fixtures.

**1:45 Ask**

> We'd like pilot repositories and feedback from teams building agent tooling. Connect your agent with one click.

---

## Recording checklist

- [ ] Both videos are under 5:00. Demo is about 3:45, pitch is 2:00 or less.
- [ ] The `PREPARED FAILURE` label is on screen during the refund beat, and the narration says the failure is staged.
- [ ] "Testnet" is said out loud at least once in each video.
- [ ] The only resolution page shown is `0xcfc9…`. The superseded `0x62206062…` page is not shown, and `0x7923e77a…` never appears as a Lemma page.
- [ ] The benchmark beat reports lemma-bench-v3 as validated on Lemma's own fixtures (indicative, not statistically powered), and discloses that v1 cost more at the provisional 0.12 price before the repricing. Nobody says "proven savings" in general.
- [ ] Pricing is described as half a cent up front, refundable under the warranty, and the rest only if the tests pass. Nothing says "twelve cents" or "a few cents" about the current price.
- [ ] The terminal shows the quote line (`0.005 USDC now + 0.053 USDC only if the tests pass`) and the `success fee` line in step `[7]`.
- [ ] The `/connect` beat shows the install buttons only; no wallet file, private key or funded address is opened on screen.
- [ ] The product mock's "Illustrative" badge is visible if the mock is on screen, so nothing looks like a faked receipt.
- [ ] No private key, `.env` content, or RPC URL with an API key appears on screen. The demo scripts scrub these, but check the browser bar and shell history too.
- [ ] Every placeholder is replaced or its line is cut.
- [ ] Upload as public or unlisted, and paste the links into [submission.md](submission.md).

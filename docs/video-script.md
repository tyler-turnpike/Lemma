# Video Scripts

Two videos for the HackQuest submission. The hard limit for each is 5:00. Deadline: **4 Oct 2026, 15:59 SGT = 13:29 IST (07:59 UTC)**.

- **A. Demo video:** targets 3:45, hard max 5:00. Product walkthrough on the live site, the terminal flow, and on-chain evidence.
- **B. Pitch video:** targets 1:55, hard max 2:00. Problem, solution, why Arbitrum and x402, honest traction, ask.

Narration runs at about 150 words per minute. Read it calmly. If a beat runs long, cut words rather than speeding up. Keep the claims inside [demo-script.md](demo-script.md), "Claims to avoid": no oracle, no marketplace, testnet is not revenue, receipts are not proof of savings, the evaluator is a trusted team key, and the refund failure in the demo is staged.

All placeholders are filled.

---

## A. Demo video (target 3:45)

### Before recording

1. Use a large terminal font (at least 18 pt), a dark theme, and a window of about 120 columns. Browser at a 1440-wide window, no bookmarks bar, no extensions.
2. Pick one terminal path:
   - **Live path (preferred if the testnet run works):** `npm run demo:testnet` (read-only preflight) must show no blockers. Record `npm run demo:testnet -- --yes`. It prints Arbiscan links. It spends about 0.24 USDC of testnet funds and gas per run.
   - **Fork path (always works, no secrets):** record `npm run demo:fork`. It prints the same numbered narrative on an Anvil fork. Fork tx hashes are not on Arbiscan, so lean on the real registry, settlement and refund transactions in shot 12 instead.
3. Either demo finishes in seconds to a few minutes, faster than the narration. Capture the output and scroll through it while narrating:
   ```bash
   npm run build                                   # once, so the recording skips the compile
   npm run demo:fork 2>&1 | tee /tmp/lemma-demo.log
   # or: npm run demo:testnet -- --yes 2>&1 | tee /tmp/lemma-demo.log
   less -R /tmp/lemma-demo.log                     # scroll section by section: [1], [2-3] ... [summary]
   ```
   Record the live command running (shot 5) and use `less` for the walkthrough (shots 6 to 11).
4. Open these browser tabs, in this order:
   1. `https://lemma-production-8383.up.railway.app/` — hero and the Live proof strip
   2. `https://lemma-production-8383.up.railway.app/resolutions/0x62206062a3d206a012817992812e8cee0b5b05d7e885b3e4c347db23dbb7fdb2` — the featured live resolution (this is what "See a live purchase" links to)
   3. `https://lemma-production-8383.up.railway.app/catalog` — both releases, price, bond, 72 h window
   4. `https://lemma-production-8383.up.railway.app/benchmark` — the honest verdict
   5. `https://lemma-production-8383.up.railway.app/status` — trust assumptions
   6. `https://sepolia.arbiscan.io/address/0x45Ae8799dF4C0878AD22CFe7040383F25f046d56` — warranty registry
   7. `https://sepolia.arbiscan.io/tx/0x7e8d2c2f4c69cb65121f70d948382624a7e041cd5bbedc4b12a387dc1305a381` — the featured settlement tx
   8. `https://sepolia.arbiscan.io/tx/0x4ce2d7730211aa1e37604ed5adccc9803a35ec487379eed61c87887fed9bc1ce` — a real bond refund
   9. `https://sepolia.arbiscan.io/tx/0xa015c0cc368327f674f4f0954816b6ccc6154a384d73c61ae41ab0105173cc42` — registry deploy tx
   10. `https://sepolia.arbiscan.io/tx/0x0663aef4a43b91840a69bb11698b1253235cb6d14d060c830a92ff2ace9e72bb` — provider bond deposit for `x402-mcp-server@1.0.0`

   Do **not** open `/resolutions/0x7923e77a…`. That resolution only ever existed in a local database; it is not on the hosted server and the page will say "Resolution not found". Its Arbiscan transactions are still valid on their own, but never show it as a clickable Lemma page.

   If `https://lemma-production-8383.up.railway.app` is down, run the server locally with the registry environment and use `http://localhost:3000` instead. If that is not possible either, drop shots 1 to 4 and 13 and give their time to the terminal walkthrough plus Arbiscan.

### Shot list and narration

| Time | Shot | On screen |
|---|---|---|
| 0:00 to 0:18 | 1. Hero | Landing page: "● Live on Arbitrum Sepolia" chip, h1 "Verified integrations / for coding agents", the lede, three CTAs |
| 0:18 to 0:38 | 2. Live proof | The strip under the hero: registry address, featured settlement tx, resolution record, then 75% / 9-of-9 / 42s and the honest cost line |
| 0:38 to 0:52 | 3. Live purchase | Click "See a live purchase" → the featured resolution page: payment, warranty voucher, adoption receipt passed |
| 0:52 to 1:06 | 4. How it works | The four steps with their mint "Live" badges: `lemma_preview`, x402 0.12 USDC ≤ cap, patch + pinned tests, `activateResolution(voucher)` |
| 1:06 to 1:18 | 5. Run | Terminal: type and run the demo command; let the banner and setup lines appear |
| 1:18 to 1:42 | 6. Preview | Log `[1]` and `[2-3]`: fixture workspace, bridge tools, decision `reuse`, price, warranty, `provisional override: YES`, policy verdict |
| 1:42 to 2:06 | 7. Pay | Log `[4-5]`: spend check, x402 settlement tx, digest and voucher signer verified, warranty activation tx, repeat buy returns `already-owned` |
| 2:06 to 2:24 | 8. Apply and verify | Log `[6]`, `[7]`, `[8]`: dry-run file list, apply, 4 acceptance tests pass, receipt accepted, evaluator `Passed` |
| 2:24 to 2:38 | 9. No-match | Log `[9]`: `python-service` and `express-no-mcp` get `decline`, no price, buy refused, 0 USDC |
| 2:38 to 3:02 | 10. Refund | Log `[10]`: the `PREPARED FAILURE` note on screen, failed receipt, evaluator `Failed`, buyer credit 0.12, `withdrawCredit`. Fork only: dropped response recovered with no second payment |
| 3:02 to 3:10 | 11. Summary | Log `[summary]` balance table and `DEMO PASSED` |
| 3:10 to 3:24 | 12. Why Arbitrum | Site "Why Arbitrum" section (three cards), then Arbiscan: registry, the featured settlement tx, the bond refund tx |
| 3:24 to 3:38 | 13. Benchmark and status | `/benchmark`: 75% fewer tokens, 9/9 vs 8/9, all-in cost 288% higher, target not met. Then `/status` trust assumptions |
| 3:38 to 3:45 | 14. Close | Back to the hero, or the README deployment table on GitHub |

### Narration (word for word, about 570 words)

**[1] 0:00 Hero**

> This is Lemma: verified integrations for coding agents, live on Arbitrum Sepolia. Agents keep re-solving solved integration work and billing you the tokens. Lemma lets an agent ask first whether a verified patch fits this repository, buy it for cents, and get a bonded warranty.

**[2] 0:18 Live proof**

> Everything on this strip is real and clickable: the warranty registry, the settlement transaction from a real twelve-cent purchase, the record for that resolution. Then the measured benchmark: seventy-five percent fewer tokens, nine of nine passes against eight of nine, forty-two seconds median instead of ninety-six. And the uncomfortable part: all-in cost is not yet lower at this price.

**[3] 0:38 Live purchase**

> Here's that purchase: the x402 payment, the provider-signed warranty voucher, and the buyer's adoption receipt, passed. Served by the production server; the transaction resolves on Arbiscan. Testnet USDC.

**[4] 0:52 How it works**

> Four steps, each live today. Preview is free. Payment goes over x402 inside caps enforced in code. The patch applies atomically, then pinned tests run locally. A provider voucher activates the bonded warranty on chain.

**[5] 1:06 Run**

> Now the whole flow in one script. Every buyer action goes through our real MCP bridge over stdio, the way Codex, Cursor or Claude Code would call it.

**[6] 1:18 Preview**

> The task: add x402 payments to a TypeScript MCP server. Before writing code, the agent calls lemma preview. The bridge reads only manifest and lockfile metadata, never source, and gets a free answer: reuse this release, twelve cents, with warranty terms. The evidence is marked provisional, because the benchmark hadn't run when these were published. Local spending policy: allowed.

**[7] 1:42 Pay**

> The agent buys. The bridge enforces caps in code, outside the model: twenty-five cents per resolution, a dollar a day, plus network, token, recipient and amount checks. Then it pays through standard x402 and our facilitator settles it. Here's the settlement transaction. The bridge verifies the digest and the provider's signature, then activates the warranty on chain, reserving provider bond. Buying again doesn't pay again.

**[8] 2:06 Apply and verify**

> It previews the patch, applies it, and runs the pinned acceptance test. Four tests pass. The buyer signs an adoption receipt, and our evaluator, a team-operated key, signs Passed, releasing the reserved bond.

**[9] 2:24 No-match**

> If nothing fits, Lemma says so for free. A Python service and an Express app with no MCP server both get decline. No price, no purchase, zero USDC.

**[10] 2:38 Refund**

> Now the failure path. This failure is staged: the harness is rigged to fail after a correct apply, and the log labels it prepared failure. The buyer submits a failed receipt, the evaluator signs Failed, and twelve cents of provider bond becomes buyer credit, withdrawn on chain. On the fork we also drop the paid response mid-flight; the bridge recovers it without paying twice.

**[11] 3:02 Summary**

> The balance table shows where every cent went. Demo passed.

**[12] 3:10 Why Arbitrum**

> Does this need a chain? Here, yes. Twelve cents settles for a fraction of a cent of gas. Refunds are enforced by the contract, not by us, and here's a real one. Every receipt is public.

**[13] 3:24 Benchmark and status**

> The benchmark page gives the verdict, not a pitch: seventy-five percent fewer tokens, nine of nine against eight of nine, under half the time, but all-in cost two hundred eighty-eight percent higher. Target missed, no savings claimed. Status: testnet only, team evaluator key, first-party infrastructure.

**[14] 3:38 Close**

> That's Lemma: pay only when it fits, with recourse when it doesn't. It's live, and open in the repo.

---

## B. Pitch video (target 1:55, hard max 2:00)

Format: talking head, or voice over five simple slides. About 285 words.

| Time | Slide or shot |
|---|---|
| 0:00 to 0:25 | Problem: an agent burning tokens on a familiar integration |
| 0:25 to 0:55 | Solution: the landing page "How it works" four steps |
| 0:55 to 1:20 | Why Arbitrum and x402: the registry on Arbiscan, the "Why Arbitrum" cards |
| 1:20 to 1:42 | Where we are: the Live proof strip, the featured resolution page, `/status` |
| 1:42 to 1:55 | Ask: repo URL and `https://lemma-production-8383.up.railway.app` |

### Narration (word for word, about 285 words)

**0:00 Problem**

> Coding agents are getting good, but they're expensive in a specific way: they keep re-solving work that's already solved. Adding payments to an MCP server is open source. Every agent still researches it, adapts it, debugs it, and bills you the tokens. And when something prepackaged doesn't fit, you have no recourse.

**0:25 Solution**

> Lemma is a compatibility layer for coding agents. Before coding, the agent asks Lemma, through a local MCP bridge, whether verified prior work fits this repository. The answer is free. If it fits, the bridge pays a few cents of USDC over x402, applies a tested patch, and runs a pinned test. If an evaluator confirms a failure, the buyer is refunded from the provider's bond. Spending caps are enforced in code, not by the model, and your source never leaves your machine.

**0:55 Why Arbitrum and x402**

> x402 gives agents a standard way to pay for a tool call. What it doesn't give is recourse after payment. Our warranty registry on Arbitrum adds that: bonds, signed vouchers, refunds, all public on Arbiscan. At twelve cents a product, settlement and warranty have to cost a fraction of that.

**1:20 Where we are**

> Lemma is a working testnet MVP, live on Arbitrum Sepolia. The registry is deployed, two releases are bonded, and you can click through a real purchase on the site: settlement, voucher, receipt. The refund path has run on chain too. One first-party provider, and the evaluator is a team key. Our benchmark measured seventy-five percent fewer tokens and better pass rates, but all-in cost was higher, so we claim no savings.

**1:42 Ask**

> We'd like feedback from teams building agent tooling on Arbitrum, and pilot repositories to test against. Try it with one command, or click through the live site.

---

## Recording checklist

- [ ] Both videos are under 5:00. Demo is about 3:45, pitch is 2:00 or less.
- [ ] The `PREPARED FAILURE` label is on screen during the refund beat, and the narration says the failure is staged.
- [ ] "Testnet" is said out loud at least once in each video.
- [ ] The only resolution page shown is `0x62206062…`. `0x7923e77a…` never appears as a Lemma page.
- [ ] The benchmark beat says the cost target was **not** met and that no savings are claimed.
- [ ] The product mock's "Illustrative" badge is visible if the mock is on screen, so nothing looks like a faked receipt.
- [ ] No private key, `.env` content, or RPC URL with an API key appears on screen. The demo scripts scrub these, but check the browser bar and shell history too.
- [ ] Every placeholder is replaced or its line is cut.
- [ ] Upload as public or unlisted, and paste the links into [submission.md](submission.md).

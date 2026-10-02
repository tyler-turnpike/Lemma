# Video Scripts

Two videos for the HackQuest submission. The hard limit for each is 5:00.

- **A. Demo video:** targets 3:30 to 4:00. Product walkthrough with commands and on-chain evidence.
- **B. Pitch video:** targets 2:00 or less. Problem, solution, why Arbitrum and x402, honest traction, ask.

Narration runs at about 140 words per minute. Read it calmly. If a beat runs long, cut words rather than speeding up. Keep the claims inside [demo-script.md](demo-script.md), "Claims to avoid": no oracle, no marketplace, testnet is not revenue, receipts are not proof of savings, and the evaluator is a trusted team key.

Placeholders to fill before recording: `[BENCHMARK RESULT]`.

---

## A. Demo video (target 3:45)

### Before recording

1. Use a large terminal font (at least 18 pt), a dark theme, and a window of about 120 columns.
2. Pick one path:
   - **Live path (preferred if the testnet run works):** `npm run demo:testnet` (read-only preflight) must show no blockers. Record `npm run demo:testnet -- --yes`. It prints Arbiscan links. It spends about 0.24 USDC of testnet funds and gas per run.
   - **Fork path (always works, no secrets):** record `npm run demo:fork`. It prints the same numbered narrative on an Anvil fork. Fork tx hashes are not on Arbiscan, so show the real registry and setup transactions on Arbiscan instead (shot 3).
3. Either demo finishes in seconds to a few minutes, faster than the narration. Capture the output and scroll through it while narrating:
   ```bash
   npm run build                                   # once, so the recording skips the compile
   npm run demo:fork 2>&1 | tee /tmp/lemma-demo.log
   # or: npm run demo:testnet -- --yes 2>&1 | tee /tmp/lemma-demo.log
   less -R /tmp/lemma-demo.log                     # scroll section by section: [1], [2-3] ... [summary]
   ```
   Record the live command running (shot 4) and use `less` for the walkthrough (shots 5 to 10).
4. Open these browser tabs in order:
   - `https://lemma-production-8383.up.railway.app/catalog`
   - `https://lemma-production-8383.up.railway.app/status`
   - `https://lemma-production-8383.up.railway.app/resolutions/0x7923e77a42bf135273f54eb029be6b207f53fb5ea2c0d19b2a1cbee37d429f8e` (a resolution ID from the live run; skip it if there is no live run)
   - `https://lemma-production-8383.up.railway.app/benchmark`
   - https://sepolia.arbiscan.io/address/0x45Ae8799dF4C0878AD22CFe7040383F25f046d56 (registry)
   - https://sepolia.arbiscan.io/tx/0xa015c0cc368327f674f4f0954816b6ccc6154a384d73c61ae41ab0105173cc42 (deploy)
   - https://sepolia.arbiscan.io/tx/0x0663aef4a43b91840a69bb11698b1253235cb6d14d060c830a92ff2ace9e72bb (a bond deposit for `x402-mcp-server@1.0.0`)
   - https://sepolia.arbiscan.io/tx/0x38e6c25b7b690e61d6de9a3ab533d7a08d71f2e0f62bdf26ae35d887d4a4f869 (the settlement tx from the live run, if there is one)

   If `https://lemma-production-8383.up.railway.app` is not deployed, run the server locally with the registry environment and use `http://localhost:3000` instead. If that is not possible either, drop shots 2 and 11 and give their time to the terminal walkthrough.

### Shot list and narration

| Time | Shot | On screen |
|---|---|---|
| 0:00 to 0:20 | 1. Title | Landing page at the hero "Stop paying agents to rediscover solved work" |
| 0:20 to 0:40 | 2. Catalog | `/catalog`: both releases, 0.12 USDC price, bond, 72 h window, "Provisional, not benchmarked" badge |
| 0:40 to 1:00 | 3. Contract | Arbiscan: registry address, deploy tx, a bond deposit tx |
| 1:00 to 1:15 | 4. Run | Terminal: type and run the demo command, and let the banner and setup lines appear |
| 1:15 to 1:45 | 5. Preview | Log sections `[1]` and `[2-3]`: fixture workspace, bridge tools, preview decision `reuse`, price, warranty, `provisional override: YES`, policy verdict |
| 1:45 to 2:15 | 6. Pay | Log `[4-5]`: spend check, x402 settlement tx, digest and voucher signer verified, warranty activation tx, repeat buy returns `already-owned` |
| 2:15 to 2:35 | 7. Apply and verify | Log `[6]` and `[7]`: dry-run file list, apply, 4 acceptance tests pass, receipt accepted. Then `[8]`: evaluator `Passed` |
| 2:35 to 2:55 | 8. No-match | Log `[9]`: `python-service` and `express-no-mcp` get `decline`, no price, buy refused, 0 USDC |
| 2:55 to 3:25 | 9. Refund | Log `[10]`: the `PREPARED FAILURE` note is visible, failed receipt, evaluator `Failed`, buyer credit 0.12, `withdrawCredit`. Fork only: the dropped response is recovered with no second payment |
| 3:25 to 3:35 | 10. Summary | Log `[summary]` balance table and `DEMO PASSED` |
| 3:35 to 3:50 | 11. Status and benchmark | `/status` trust assumptions, then `/benchmark` "Not run yet" or `[BENCHMARK RESULT]` |
| 3:50 to 4:00 | 12. Close | README on GitHub with the deployment table |

### Narration (word for word, about 520 words)

**[1] 0:00 Title**

> This is Lemma. Coding agents keep re-solving the same integration work: research it, adapt it, debug it, pay for it in tokens. Lemma lets an agent check first whether verified prior work fits its repository, and buy it for a few cents, with a bonded warranty on Arbitrum.

**[2] 0:20 Catalog**

> Here's the catalog. Two curated releases: adding x402 payments to a TypeScript MCP server, and an x402-paying MCP client with spending limits. Each costs twelve cents in testnet USDC and has a seventy-two hour warranty window. They're marked provisional because our benchmark hasn't run yet. The demo server is set to sell them anyway, and it says so.

**[3] 0:40 Contract**

> The warranty registry is deployed on Arbitrum Sepolia. Both releases are registered, and the provider has bonded one USDC behind each. That bond is what a buyer gets refunded from.

**[4] 1:00 Run**

> Now the whole flow, in one script. Every buyer action goes through our real MCP bridge over standard input and output, exactly the way Codex, Cursor or Claude Code would call it.

**[5] 1:15 Preview**

> The task: add x402 payments on Arbitrum Sepolia to a TypeScript MCP server. Before writing code, the agent calls lemma preview. The bridge reads only manifest and lockfile metadata, never source, and gets a free answer: reuse this release, twelve cents, with the warranty terms and limitations. It also checks the local spending policy: allowed.

**[6] 1:45 Pay**

> The agent buys it. The bridge enforces the caps in code, outside the model: twenty-five cents per resolution, one dollar a day, the right network, token, recipient and amount. Then it pays through standard x402. Our facilitator settles the USDC to the provider. Here's the settlement transaction. The bridge verifies the payload digest and the provider's signature, then activates the warranty on chain, which reserves provider bond. Buying again doesn't pay again.

**[7] 2:15 Apply and verify**

> It previews the patch, applies it, and runs the release's pinned acceptance test. Four tests pass. The buyer signs an adoption receipt, and our evaluator, which is a team-operated key, signs Passed. The reserved bond goes back to the provider.

**[8] 2:35 No-match**

> If nothing fits, Lemma says so for free. A Python service and an Express app with no MCP server both get decline. No price, the bridge refuses to buy, and zero USDC is spent.

**[9] 2:55 Refund**

> Now the failure path. To be clear, this failure is staged. This workspace's test harness is rigged to fail after a correct apply, and the log labels it as prepared. The buyer submits a failed receipt, the evaluator signs Failed, and twelve cents from the provider's bond becomes buyer credit, which the buyer withdraws. On the fork we also drop the paid response mid-flight. The bridge recovers it by ID without paying twice.

**[10] 3:25 Summary**

> The balance table shows where every cent went. Demo passed.

**[11] 3:35 Status and benchmark**

> The status page states our trust assumptions: testnet only, a trusted team evaluator, and first-party infrastructure. And we haven't claimed savings. The paired benchmark is built and will report whatever it measures.

**[12] 3:50 Close**

> That's Lemma: pay only when it fits, with recourse if it doesn't. Everything's open in the repo.

If the benchmark has run by recording time, replace the last two sentences of [11] with one plain sentence that reads the result from `[BENCHMARK RESULT]`, for example "Across twenty runs, the Lemma arm used X percent fewer tokens," or "it did not meet the target." Do not round up.

---

## B. Pitch video (target 1:50, hard max 2:00)

Format: talking head, or voice over five simple slides. About 260 words.

| Time | Slide or shot |
|---|---|
| 0:00 to 0:25 | Problem: an agent burning tokens on a familiar integration |
| 0:25 to 0:55 | Solution: the flow diagram from the README |
| 0:55 to 1:20 | Why Arbitrum and x402: the registry on Arbiscan |
| 1:20 to 1:40 | Where we are: terminal with `DEMO PASSED`, the `/status` page |
| 1:40 to 1:55 | Ask: repo URL and `https://lemma-production-8383.up.railway.app` |

### Narration (word for word)

**0:00 Problem**

> Coding agents are getting good, but they're expensive in a specific way: they keep re-solving work that's already solved. Adding payments to an MCP server is open source. Every agent still researches it, adapts it, debugs it, and bills you for the tokens. And when a prepackaged solution doesn't fit your repo, you have no recourse.

**0:25 Solution**

> Lemma is a compatibility layer for coding agents. Before coding, the agent asks Lemma, through a local MCP bridge, whether verified prior work fits this repository. The answer is free. If it fits, the bridge pays a few cents in USDC, applies a tested patch, and runs a pinned acceptance test. If an evaluator confirms it failed, the buyer is refunded from the provider's bond. Spending limits are enforced in code, not by the model, and your source never leaves your machine.

**0:55 Why Arbitrum and x402**

> x402 gives agents a standard way to pay for a tool call. What it doesn't give you is recourse after payment. Our warranty registry on Arbitrum adds that: bonds, signed vouchers, refunds. When the product costs twelve cents, settlement and warranty have to cost a fraction of that, and Arbitrum makes that possible.

**1:20 Where we are**

> Today Lemma is a working testnet MVP. The registry is live on Arbitrum Sepolia, two releases are bonded, and the full flow passes end to end: payment, warranty, refund, and recovery. It's one first-party provider, and the evaluator is a team key. We haven't claimed savings yet. A twenty-run paired benchmark is ready to measure that.

**1:40 Ask**

> We'd like feedback from teams building agent tooling on Arbitrum, and pilot repositories to test against. Try the demo with one command. It's all in the repo.

---

## Recording checklist

- [ ] Both videos are under 5:00. Demo is about 3:45, pitch is 2:00 or less.
- [ ] The `PREPARED FAILURE` label is on screen during the refund beat, and the narration says the failure is staged.
- [ ] "Testnet" is said out loud at least once in each video.
- [ ] No private key, `.env` content, or RPC URL with an API key appears on screen. The demo scripts scrub these, but check the browser bar and shell history too.
- [ ] Every placeholder is replaced or its line is cut.
- [ ] Upload as public or unlisted, and paste the links into [submission.md](submission.md).

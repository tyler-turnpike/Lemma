# Benchmark Protocol

## Question

Does Lemma reduce all-in cost-to-green for supported integration tasks without lowering correctness?

## Design

Use the OpenAI Codex SDK (`@openai/codex-sdk` 0.160.0, which drives `codex-cli` 0.160.0 from the repository's `node_modules`) with an explicit local runtime. Query available models once, select one model and parameter set, and freeze them before measured runs. Load no ambient settings: every run gets a fresh, empty `CODEX_HOME` and `HOME`, a CLI environment with no inherited variables, and `project_doc_max_bytes = 0`.

Frozen for experiment `lemma-bench-v1` (`packages/benchmark/src/config.ts`):

- Model `gpt-5.6-luna` (lowest-priced gpt-5.6 model, chosen to fit the API budget; a terra smoke run cost about $0.38, a luna smoke run about $0.03), reasoning effort `medium`, approval policy `never`. `GET /v1/models` listed the gpt-5.4, gpt-5.5 and gpt-5.6 families on 2026-10-02. Codex 0.160.0 ships model metadata for gpt-5.5 and gpt-5.6 but not for dated snapshots, which run with degraded fallback metadata. The chosen model is therefore an alias, and provider-side updates during the run window are an uncontrolled variable.
- Time budget: 20 minutes of wall-clock agent time per run. Acceptance runs afterwards and is not counted against the budget.
- Cost: an estimate from a frozen standard-tier list-price table (USD per 1M tokens: input 2.00, cached input 0.20, output 12.00), read from the OpenAI pricing page on 2026-10-02. Codex reports tokens but no charged amount, so every cost figure is labelled `estimate`, and token counts serve as the independent measure.

The matrix contains three matched tasks with control and Lemma treatment arms, three repetitions per arm, plus one no-match task in both arms. Total: twenty runs.

| Task | Fixture | Release | Expected decision |
|---|---|---|---|
| `mcp-server-paywall-exact` | `mcp-server-exact` | `x402-mcp-server@1.0.0` | reuse |
| `mcp-client-paying-exact` | `mcp-client-exact` | `x402-mcp-client@1.0.0` | reuse |
| `mcp-server-paywall-boundary` | `mcp-server-boundary` | `x402-mcp-server@1.0.0` | adapt |
| `express-paywall-no-match` | `express-no-mcp` | none (must decline) | decline |

Run order is deterministic and interleaved. Control runs first on odd repetitions and treatment runs first on even ones, and the no-match pair runs last. `npm run benchmark -- --plan` prints the matrix.

## Controls

- Identical starting repository for each pair: a fresh temp copy of the catalog fixture per run, plus the task's acceptance test. The fixture digest (sha256 over file hashes) is recorded.
- Identical user task and acceptance tests. Matched tasks use the release's own shipped acceptance test, installed before the agent starts in both arms. The no-match task uses a benchmark-owned test (`packages/benchmark/tasks/express-x402-paywall/test/`) with an in-process facilitator. Before the matrix was frozen, it was checked to fail on the fixture and to pass against a reference implementation.
- Fresh agent and fresh fixture copy per run.
- Same model, parameters, time budget, network policy, and machine.
- Same sandbox for both arms. A Codex permission profile equivalent to `workspace-write`: read everywhere, write the workspace and tmp, and shell network disabled. Reads are denied for every top-level repository entry except `node_modules` (which hides catalog releases, server, bridge, `.env` and git history), for the per-run harness directory, and for Lemma's own `@lemma/*` packages, which are left out of the workspace's `node_modules`. Dependencies resolve from the repository's installed packages through per-package symlinks.
- Same research channel: Codex web search in `cached` mode for both arms.
- The treatment prompt is the control prompt followed by the installed Lemma rule, and treatment also gets the `lemma-mcp` bridge as a Codex MCP server. Bridge tools are auto-approved. Spend limits are enforced in the bridge: 0.25 USDC per resolution and a 1.50 USDC daily cap, with a ledger shared across the experiment's runs.
- Control can use its normal tools and open-source research.
- After the agent finishes, the harness restores the acceptance test's original bytes if the agent changed it and records `testTampered`. It then runs the release acceptance recipe with `runAcceptance` from `@lemma/core`.

## Measurements

- Input, cached input, cache-write input, output, reasoning, and total tokens, as reported by Codex `turn.completed`.
- Estimated raw model cost, Lemma price, and estimated all-in cost. The SDK reports no charged cost.
- Wall-clock duration, total and agent-only.
- Tool calls by type (commands, failed commands, file changes, MCP calls, web searches) and the list of MCP calls. Failed runs are not retried; every run is kept.
- Files added, modified, and deleted, excluding `node_modules` and the sandbox's `.tmp`.
- Acceptance outcome.
- Human interventions. The harness is fully automated, so this is always 0.
- Lemma preview decision, x402 price, payment hash, warranty activation status and tx hash. Gas is recorded when the bridge reports it; it currently does not.
- Errors are classified as startup (no thread started), run, timeout, or harness.

## Success criteria

- Both arms pass the same acceptance tests.
- Treatment median all-in raw cost is at least 25 percent lower.
- Treatment median total tokens are at least 25 percent lower.
- No correctness regression occurs: on every task, the treatment pass rate is at least the control pass rate.
- No-match treatment spends zero USDC.
- A paid response can be recovered without duplicate payment. The bridge test suite covers this; the matrix does not exercise it.

## Integrity rules

Freeze prompts, fixtures, releases, and analysis code before final runs. Keep every run, including failures. Do not combine exploratory runs with the final paired matrix. Smoke runs are written to `runs/exploratory/` with `series: "exploratory"`, and the report never reads them. If the target is missed, report the measured result without claiming validated savings. The report states "Not validated", lists the missed criteria, and says "Savings are not claimed". A partial matrix is reported as "Incomplete". `--run` never overwrites an existing record, so an interrupted matrix resumes without rerunning recorded runs.

## Secrets

The harness reads `.env` into a private object and never into `process.env`. The OpenAI key reaches the Codex CLI only as `CODEX_API_KEY` in its environment, never in argv. Shell commands inherit only core variables. Codex passes MCP settings on its command line, so the buyer key and RPC URL are written to a 0600 file in a 0700 harness directory that the sandbox cannot read. A launcher sets them on the bridge's `process.env` at runtime and then loads the bridge. The key never appears in a prompt, in argv, or in `/proc/<pid>/environ`, and the file is deleted when the run ends. Every record is deep-redacted with core `redact` and `secretsFromEnv`, then checked again before it is written. A record that still contains a known secret is refused.

## Output

Raw records remain in the ignored `packages/benchmark/runs` directory. A scrubbed aggregate and machine-readable summary may be published after checking that no prompt, tool output, path, or environment field contains a credential. `npm run benchmark -- --report` performs that check and writes `packages/benchmark/published/aggregate.json`, which is git-ignored until a real run. `apps/server` serves that file at `GET /api/v1/benchmarks`.

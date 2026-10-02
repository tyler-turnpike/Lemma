# Lemma Benchmark

## Purpose and economic role

The benchmark tests the core claim: a paid Compatibility Resolution should reduce the buyer's all-in cost-to-green without reducing correctness. It is evidence for pricing and product-market fit, not a decorative performance chart.

## Responsibilities

- Run matched control and Lemma treatment tasks through the OpenAI Codex SDK.
- Freeze model, prompts, fixtures, repository state, settings, and time limits.
- Capture model usage, cost, duration, tool calls, edits, test results, intervention, payment, and gas data.
- Preserve raw run records outside source control.
- Produce a public aggregate with honest limitations.

## Outside this boundary

- Modifying catalog releases during a final experiment.
- Hiding failed or expensive runs.
- Mixing old runner results into a paired comparison.
- Using benchmark outcomes to bypass compatibility rules.

## Experiment (status: harness implemented, final matrix not yet run)

- Three matched tasks: x402 paywall on the exact MCP server fixture, x402-paying client on the exact client fixture, and x402 paywall on the boundary server fixture.
- Control and Lemma treatment arms.
- Three repetitions per arm.
- One no-match task (Express API) in both arms.
- Twenty runs total. `npm run benchmark -- --plan` prints them.

The success target is at least 25 percent lower median all-in raw cost and total tokens, with identical acceptance results and zero payment for the no-match treatment. The full design, controls and integrity rules are in [docs/benchmark-protocol.md](../../docs/benchmark-protocol.md).

## Usage

```bash
npm run benchmark -- --plan            # frozen matrix and parameters; no API calls
npm run benchmark -- --smoke           # ONE control run on one task to validate the harness (spends a little)
npm run benchmark -- --run --confirm   # the full 20-run matrix
npm run benchmark -- --report          # aggregate final records -> published/aggregate.json
```

`--smoke` writes to `runs/exploratory/<experiment>/` and is never aggregated. `--run` writes `runs/<experiment>/<runId>.json` and skips run ids that are already recorded, so an interrupted matrix can resume. Before any paid run, it checks that the server is healthy, that paid tools are enabled, that the server sells provisional releases, that the provider address matches, that the buyer key is present, and that the bridge is built. `--report` builds the aggregate from final records only. It refuses to publish anything that contains a known secret or a filesystem path, and it states "Not validated" or "Incomplete" when the criteria are not met.

## Source layout

- `src/config.ts`: frozen model, parameters, time budget, price table (estimate), bridge limits, criteria.
- `src/tasks.ts`, `tasks/`: the four tasks and the benchmark-owned no-match acceptance test.
- `src/prompts.ts`: shared task prompt and the Lemma rule appended for treatment.
- `src/matrix.ts`: the 20-run plan.
- `src/workspace.ts`: fresh fixture copies, curated `node_modules` symlinks without `@lemma/*`, snapshots and diffs.
- `src/codex-config.ts`: Codex options (permission profile, env, MCP server for treatment).
- `src/agent.ts`: streamed Codex run with a hard budget, usage, tool-call and payment extraction.
- `src/runner.ts`: one run end to end (agent, tamper check, `runAcceptance`, record, redaction).
- `src/report.ts`: medians, reductions, criteria and the honest summary.
- `src/schema.ts`: Zod schemas for run records and the published aggregate.
- `bin/bridge-launcher.mjs`: starts `lemma-mcp` with the buyer key read from the harness secrets file.

## Workspace dependencies

- `@openai/codex-sdk` (0.160.0, which drives the `codex` CLI 0.160.0 from `node_modules/.bin`) for controlled local agent runs.
- `@lemma/core` for redaction and `runAcceptance`.
- `@lemma/catalog` for fixtures, release bundles and acceptance recipes.
- Zod for record schemas.

## Environment variables

These are read from the repository's `.env` (or the shell environment) and never copied into `process.env`.

| Variable | Used for |
|---|---|
| `OPENAI_API_KEY` | Codex CLI authentication (passed as `CODEX_API_KEY` in the CLI env only) |
| `LEMMA_API_URL` | Hosted Lemma server for treatment runs |
| `BENCHMARK_BUYER_PRIVATE_KEY` | Funded Arbitrum Sepolia buyer wallet; given only to the bridge process |
| `LEMMA_PROVIDER_ADDRESS` | Expected `payTo` and voucher signer |
| `RESOLUTION_WARRANTY_REGISTRY_ADDRESS`, `ARBITRUM_SEPOLIA_RPC_URL`, `USDC_ADDRESS` | Optional; passed to the bridge for warranty activation |

The model is frozen in `src/config.ts` (`gpt-5.6-luna`), not read from the environment. `LEMMA_BENCHMARK_MODEL` is unused.

## Development and tests

- `npm run build -w @lemma/benchmark`
- `npm run test -w @lemma/benchmark` (offline: schema, matrix, report math, redaction, prompt equality, Codex config, workspaces)
- `npm run benchmark -- --plan`

## Security constraints

- Do not put credentials in prompts, command arguments, run records, or committed fixtures.
- Use an explicit local runtime (the repository's `codex` binary) with an empty `CODEX_HOME`, an empty `HOME`, and no inherited environment.
- Keep each run in a fresh fixture copy.
- Dispose SDK resources and distinguish startup failures from run failures.
- Treat provider cost as eventually consistent and retain token counts as an independent measure.

## Later completion criteria

This component is complete when the frozen twenty-run matrix is reproducible, raw records validate against a schema, all interventions are disclosed, and the report can be regenerated without hand-editing results.

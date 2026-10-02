import { getJson, type ApiState } from "../api/client.js";
import { parseBenchmarks } from "../api/parse.js";
import type { BenchmarkAggregate, BenchmarkArm, BenchmarksResponse } from "../api/types.js";
import { useApi } from "../api/useApi.js";
import { Badge } from "../components/dashboard/Badge.js";
import { ExternalLink, Stat } from "../components/dashboard/Fields.js";
import { DashboardShell, PageHeader, Panel } from "../components/dashboard/Shell.js";
import { ErrorState, LoadingState, MessageState } from "../components/dashboard/States.js";
import { PillLink } from "../components/PillLink.js";
import { dashboard, links } from "../content.js";
import { formatDateTime, formatInteger, formatPercent, formatUsd, formatUsdcAtomic } from "../lib/format.js";

const copy = dashboard.benchmark;

function NotRun() {
  return (
    <div data-state="empty" className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="rounded-md border border-line bg-card px-6 py-10 md:px-8 md:py-12">
        <p className="font-mono text-xs text-faint">status: not-run</p>
        <p className="mt-3 text-section text-fg">{copy.notRun.title}</p>
        <p className="mt-4 max-w-md leading-relaxed text-muted">{copy.notRun.body}</p>
        <p className="mt-8 border-l border-fg pl-4 leading-relaxed text-fg">{copy.notRun.target}</p>
        <div className="mt-10">
          <PillLink href={links.benchmarkProtocol}>{copy.notRun.cta}</PillLink>
        </div>
      </div>
      <Panel title="Planned protocol" aside={<Badge>Target only</Badge>}>
        <dl className="divide-y divide-line">
          {copy.notRun.protocol.map(([term, value]) => (
            <div key={term} className="flex justify-between gap-6 px-5 py-4 text-sm md:px-6">
              <dt className="text-muted">{term}</dt>
              <dd className="text-right text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}

/** Prefers the aggregate's own criteria verdict; falls back to comparing against the 25% target. */
function targetBadge(value: number | null, met: boolean | null) {
  if (value === null && met === null) return undefined;
  return (met ?? (value !== null && value >= copy.target)) ? <Badge tone="success">Meets 25% target</Badge> : <Badge>Below 25% target</Badge>;
}

function reductionText(value: number | null): string {
  if (value === null) return "—";
  return value >= 0 ? `${formatPercent(value)} lower` : `${formatPercent(-value)} higher`;
}

function armCell(arm: BenchmarkArm, metric: keyof BenchmarkArm): string {
  const v = arm[metric];
  if (v === null) return "—";
  switch (metric) {
    case "runs":
    case "passed":
      return String(v);
    case "medianCostUsd":
      return formatUsd(v);
    case "medianTotalTokens":
      return formatInteger(v);
    case "passRate":
      return formatPercent(v);
    case "medianDurationMs":
      return `${(v / 1000).toFixed(0)}s`;
  }
}

const metrics: readonly (readonly [keyof BenchmarkArm, string])[] = [
  ["runs", "Runs"],
  ["passed", "Passed acceptance"],
  ["medianCostUsd", "Median all-in cost"],
  ["medianTotalTokens", "Median total tokens"],
  ["passRate", "Acceptance pass rate"],
  ["medianDurationMs", "Median wall clock"],
];

function Published({ aggregate }: { readonly aggregate: BenchmarkAggregate }) {
  const n = aggregate.runs ?? ((aggregate.control.runs ?? 0) + (aggregate.treatment.runs ?? 0) + (aggregate.noMatchRuns ?? 0) || null);
  const verdict =
    aggregate.verdict === "validated" ? (
      <Badge tone="success">Validated</Badge>
    ) : aggregate.verdict === "not-validated" ? (
      <Badge tone="strong">Target not met</Badge>
    ) : aggregate.verdict === "incomplete" ? (
      <Badge>Incomplete</Badge>
    ) : null;
  const noMatchZero = aggregate.noMatchSpendAtomic !== null && /^0+$/.test(aggregate.noMatchSpendAtomic);
  return (
    <div className="space-y-6" data-state="ready">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
        <Badge>Testnet</Badge>
        {verdict}
        <span>
          {aggregate.network ?? "arbitrum-sepolia"} · n={n ?? "?"}
          {aggregate.plannedRuns === null ? "" : ` of ${aggregate.plannedRuns} planned`} runs
          {aggregate.model === null ? "" : ` · model ${aggregate.model}`}
          {aggregate.benchmarkVersion === null ? "" : ` · benchmark ${aggregate.benchmarkVersion}`}
          {aggregate.generatedAt === null ? "" : ` · published ${formatDateTime(aggregate.generatedAt)}`}
        </span>
      </p>

      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-3">
        <Stat label="Median all-in cost, Lemma vs control" value={reductionText(aggregate.costReduction)} note={targetBadge(aggregate.costReduction, aggregate.criteria.costTargetMet)} />
        <Stat label="Median total tokens, Lemma vs control" value={reductionText(aggregate.tokenReduction)} note={targetBadge(aggregate.tokenReduction, aggregate.criteria.tokenTargetMet)} />
        <Stat
          label="No-match treatment spend"
          value={aggregate.noMatchSpendAtomic === null ? "—" : formatUsdcAtomic(aggregate.noMatchSpendAtomic)}
          note={aggregate.noMatchSpendAtomic === null ? undefined : noMatchZero ? <Badge tone="success">Zero spend</Badge> : <Badge tone="strong">Paid on no-match</Badge>}
        />
      </div>

      {aggregate.summary === null ? null : <p className="max-w-3xl leading-relaxed text-fg">{aggregate.summary}</p>}

      <Panel title="Per-arm medians, matched tasks" aside={<span className="text-xs text-faint">testnet · n={n ?? "?"}</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="px-5 py-3 font-normal md:px-6">Metric</th>
                <th scope="col" className="px-5 py-3 text-right font-normal md:px-6">Control · n={aggregate.control.runs ?? "?"}</th>
                <th scope="col" className="px-5 py-3 text-right font-normal md:px-6">Lemma · n={aggregate.treatment.runs ?? "?"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {metrics.map(([key, label]) => (
                <tr key={key}>
                  <th scope="row" className="px-5 py-3.5 text-left font-normal text-muted md:px-6">{label}</th>
                  <td className="px-5 py-3.5 text-right font-mono text-fg tabular-nums md:px-6">{armCell(aggregate.control, key)}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-fg tabular-nums md:px-6">{armCell(aggregate.treatment, key)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {aggregate.costLabel === null ? null : <p className="border-t border-line px-5 py-4 text-xs leading-relaxed text-faint md:px-6">{aggregate.costLabel}</p>}
      </Panel>

      {aggregate.limitations.length === 0 ? null : (
        <Panel title="Limitations">
          <ul className="space-y-2 px-5 py-5 text-sm leading-relaxed md:px-6">
            {aggregate.limitations.map((limitation, i) => (
              <li key={i} className="flex gap-3">
                <span aria-hidden="true" className="mt-[0.6em] h-px w-2.5 shrink-0 bg-faint" />
                <span className="min-w-0">{limitation}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <p className="text-sm text-muted">
        Method: <ExternalLink href={links.benchmarkProtocol}>docs/benchmark-protocol.md</ExternalLink>
      </p>
    </div>
  );
}

export function BenchmarkView({ state, onRetry }: { readonly state: ApiState<BenchmarksResponse>; readonly onRetry?: () => void }) {
  return (
    <DashboardShell active="/benchmark">
      <PageHeader label={copy.label} headline={copy.headline} lede={copy.lede} />
      <div className="mt-16 md:mt-24">
        {state.status === "loading" ? (
          <LoadingState rows={4} />
        ) : state.status === "error" ? (
          <ErrorState error={state.error} {...(onRetry === undefined ? {} : { onRetry })} />
        ) : state.data.status === "not-run" ? (
          <NotRun />
        ) : state.data.aggregate === null ? (
          <MessageState state="unrecognised" title="Aggregate unreadable" body={copy.unrecognised} />
        ) : (
          <Published aggregate={state.data.aggregate} />
        )}
      </div>
    </DashboardShell>
  );
}

export function BenchmarkPage() {
  const { state, retry } = useApi("benchmarks", (signal) => getJson("/api/v1/benchmarks", parseBenchmarks, { signal }));
  return <BenchmarkView state={state} onRetry={retry} />;
}

import type { ReactNode } from "react";

import { getJson } from "../api/client.js";
import { parseBenchmarks, parseStatus } from "../api/parse.js";
import type { BenchmarkAggregate } from "../api/types.js";
import { useApi } from "../api/useApi.js";
import { benchmarkFallback, featured, featuredPath, liveProof } from "../content.js";
import { shortHex } from "../lib/format.js";
import { arbiscanAddress, arbiscanTx, isAddress } from "../lib/links.js";
import { Link } from "../router.js";
import { ExternalLink } from "./dashboard/Fields.js";

export interface ProofFigures {
  readonly tokenReduction: number;
  readonly treatmentPassed: number;
  readonly controlPassed: number;
  readonly treatmentRuns: number;
  readonly controlRuns: number;
  readonly treatmentSeconds: number;
  readonly controlSeconds: number;
  /** Signed: negative means Lemma cost more all-in. */
  readonly costReduction: number;
}

const f = benchmarkFallback;

export const fallbackFigures: ProofFigures = {
  tokenReduction: (f.controlTokens - f.treatmentTokens) / f.controlTokens,
  treatmentPassed: f.treatmentPassed,
  controlPassed: f.controlPassed,
  treatmentRuns: f.runsPerArm,
  controlRuns: f.runsPerArm,
  treatmentSeconds: Math.round(f.treatmentDurationMs / 1000),
  controlSeconds: Math.round(f.controlDurationMs / 1000),
  costReduction: (f.controlCostUsd - f.treatmentCostUsd) / f.controlCostUsd,
};

/** Live aggregate values where present; any missing field keeps the published fallback. */
export function figuresFrom(aggregate: BenchmarkAggregate | null): ProofFigures {
  if (aggregate === null) return fallbackFigures;
  const { control, treatment } = aggregate;
  const secs = (ms: number | null, fallback: number) => (ms === null ? fallback : Math.round(ms / 1000));
  return {
    tokenReduction: aggregate.tokenReduction ?? fallbackFigures.tokenReduction,
    treatmentPassed: treatment.passed ?? fallbackFigures.treatmentPassed,
    controlPassed: control.passed ?? fallbackFigures.controlPassed,
    treatmentRuns: treatment.runs ?? fallbackFigures.treatmentRuns,
    controlRuns: control.runs ?? fallbackFigures.controlRuns,
    treatmentSeconds: secs(treatment.medianDurationMs, fallbackFigures.treatmentSeconds),
    controlSeconds: secs(control.medianDurationMs, fallbackFigures.controlSeconds),
    costReduction: aggregate.costReduction ?? fallbackFigures.costReduction,
  };
}

function ProofItem({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-5 py-5 md:px-6">
      <p className="text-xs text-muted">{label}</p>
      <div className="mt-2 font-mono text-[0.8125rem] text-fg">{children}</div>
    </div>
  );
}

function Figure({ value, caption }: { readonly value: string; readonly caption: string }) {
  return (
    <div className="min-w-0 bg-card px-5 py-5 md:px-6">
      <p className="font-mono text-2xl text-mint tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted">{caption}</p>
    </div>
  );
}

export function LiveProof() {
  const status = useApi("landing-status", (signal) => getJson("/api/v1/status", parseStatus, { signal }));
  const bench = useApi("landing-benchmarks", (signal) => getJson("/api/v1/benchmarks", parseBenchmarks, { signal }));

  const liveRegistry = status.state.status === "ready" ? status.state.data.registry : null;
  const registry = isAddress(liveRegistry) ? liveRegistry : featured.registry;
  const aggregate = bench.state.status === "ready" && bench.state.data.status === "published" ? bench.state.data.aggregate : null;
  const fig = figuresFrom(aggregate);
  const costLower = fig.costReduction > 0;

  return (
    <section aria-labelledby="proof-title" className="pb-8 md:pb-16">
      <div className="container-page">
        <h2 id="proof-title" className="sr-only">
          {liveProof.label}
        </h2>
        <div className="overflow-hidden rounded-md border border-line bg-line">
          <div className="grid gap-px md:grid-cols-3">
            <ProofItem label={liveProof.registry}>
              <ExternalLink href={arbiscanAddress(registry)}>
                <span title={registry}>{shortHex(registry, 8, 6)}</span>
              </ExternalLink>
            </ProofItem>
            <ProofItem label={liveProof.settlement}>
              <ExternalLink href={arbiscanTx(featured.settlementTx)}>
                <span title={featured.settlementTx}>{shortHex(featured.settlementTx, 8, 6)}</span>
              </ExternalLink>
              <span className="ml-2 font-sans text-xs text-muted">{featured.price}</span>
            </ProofItem>
            <ProofItem label={liveProof.resolution}>
              <Link href={featuredPath} className="inline-flex items-center gap-1 text-fg underline decoration-line underline-offset-4 transition-colors hover:text-mint hover:decoration-mint">
                <span title={featured.resolutionId}>{shortHex(featured.resolutionId, 8, 6)}</span>
                <span aria-hidden="true">→</span>
              </Link>
            </ProofItem>
          </div>
          <div className="mt-px grid gap-px sm:grid-cols-3">
            <Figure value={`${Math.round(fig.tokenReduction * 100)}%`} caption="fewer tokens" />
            <Figure value={`${fig.treatmentPassed}/${fig.treatmentRuns}`} caption={`passes vs ${fig.controlPassed}/${fig.controlRuns} without Lemma`} />
            <Figure value={`${fig.treatmentSeconds}s`} caption={`median run vs ${fig.controlSeconds}s`} />
          </div>
          <p className="mt-px flex flex-wrap items-center gap-x-2 gap-y-1 bg-card px-5 py-4 text-sm text-muted md:px-6">
            <span className="text-faint">{liveProof.measured} ·</span>
            <span>
              {costLower ? `All-in cost ${Math.round(fig.costReduction * 100)}% lower` : liveProof.honest}
            </span>
            <span aria-hidden="true" className="text-faint">·</span>
            <Link href="/benchmark" className="text-fg transition-colors hover:text-mint">
              {liveProof.benchmarkLink} <span aria-hidden="true">→</span>
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

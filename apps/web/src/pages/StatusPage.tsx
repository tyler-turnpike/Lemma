import type { ReactNode } from "react";

import { getJson, probe, type ApiState } from "../api/client.js";
import { parseStatus } from "../api/parse.js";
import type { StatusResponse } from "../api/types.js";
import { useApi } from "../api/useApi.js";
import { Badge } from "../components/dashboard/Badge.js";
import { DataList, ExternalLink, Hash } from "../components/dashboard/Fields.js";
import { DashboardShell, PageHeader, Panel } from "../components/dashboard/Shell.js";
import { ErrorState, LoadingState } from "../components/dashboard/States.js";
import { dashboard, links } from "../content.js";
import { arbiscanAddress, arbiscanToken } from "../lib/links.js";

const copy = dashboard.status;

export type ServiceHealth =
  | { readonly state: "ok"; readonly detail: string | null }
  | { readonly state: "disabled" }
  | { readonly state: "error"; readonly status: number }
  | { readonly state: "unreachable" };

export interface StatusRecord {
  readonly status: StatusResponse;
  readonly health: ServiceHealth;
  readonly facilitator: ServiceHealth;
}

function supportedKinds(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const kinds = (body as { kinds?: unknown }).kinds;
  if (!Array.isArray(kinds)) return null;
  const labels = kinds
    .slice(0, 8)
    .map((k: unknown) => {
      if (typeof k !== "object" || k === null) return null;
      const { scheme, network } = k as { scheme?: unknown; network?: unknown };
      return typeof scheme === "string" && typeof network === "string" ? `${scheme.slice(0, 32)} · ${network.slice(0, 64)}` : null;
    })
    .filter((l): l is string => l !== null);
  return labels.length === 0 ? null : labels.join(", ");
}

export async function loadStatus(signal: AbortSignal): Promise<StatusRecord> {
  const [status, health, facilitator] = await Promise.all([
    getJson("/api/v1/status", parseStatus, { signal }),
    probe("/health", { signal }),
    probe("/facilitator/supported", { signal }),
  ]);
  return {
    status,
    health: health === null ? { state: "unreachable" } : health.ok ? { state: "ok", detail: null } : { state: "error", status: health.status },
    facilitator:
      facilitator === null
        ? { state: "unreachable" }
        : facilitator.ok
          ? { state: "ok", detail: supportedKinds(facilitator.body) }
          : facilitator.status === 503
            ? { state: "disabled" }
            : { state: "error", status: facilitator.status },
  };
}

function healthBadge(health: ServiceHealth): ReactNode {
  switch (health.state) {
    case "ok":
      return <Badge tone="success">Operational</Badge>;
    case "disabled":
      return <Badge>Not configured</Badge>;
    case "error":
      return <Badge tone="strong">HTTP {health.status}</Badge>;
    case "unreachable":
      return <Badge tone="strong">Unreachable</Badge>;
  }
}

function AddressValue({ value, href }: { readonly value: string | null; readonly href: string | null }) {
  return value === null ? <span className="text-muted">{copy.notConfigured}</span> : <Hash value={value} href={href} full />;
}

/** Always rendered, even when the API is offline: the trust assumptions are static facts. */
export function TrustNotice({ serverNotice }: { readonly serverNotice?: string | null }) {
  return (
    <section aria-labelledby="trust-title" className="rounded-md border border-fg/25 bg-card">
      <div className="grid gap-6 px-5 py-6 md:grid-cols-[14rem_1fr] md:gap-12 md:px-6 md:py-8">
        <h2 id="trust-title" className="flex items-start gap-2.5 text-fg">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mt-1 size-4 shrink-0">
            <path d="M8 1.5 2.5 3.5v4c0 3.2 2.3 6 5.5 7 3.2-1 5.5-3.8 5.5-7v-4L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          {copy.trust.title}
        </h2>
        <div className="min-w-0">
          <ul className="space-y-2.5 leading-relaxed text-fg">
            {copy.trust.points.map((point) => (
              <li key={point} className="flex gap-3">
                <span aria-hidden="true" className="mt-[0.7em] h-px w-2.5 shrink-0 bg-muted" />
                <span className="min-w-0">{point}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm leading-relaxed text-muted">{copy.trust.footnote}</p>
          {serverNotice === undefined || serverNotice === null ? null : (
            <p className="mt-5 border-t border-line pt-5 text-sm leading-relaxed text-muted">
              <span className="text-faint">Server notice · </span>
              {serverNotice}
            </p>
          )}
          <p className="mt-5 text-sm">
            <ExternalLink href={links.securityModel}>Security model</ExternalLink>
          </p>
        </div>
      </div>
    </section>
  );
}

function StatusDetail({ record }: { readonly record: StatusRecord }) {
  const { status } = record;
  return (
    <div className="space-y-6" data-state="ready">
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={copy.sections.chain} aside={<Badge>Testnet</Badge>}>
          <DataList
            rows={[
              ["Network", <span className="font-mono text-[0.8125rem]">{status.chain.network}</span>],
              ["Chain id", <span className="font-mono text-[0.8125rem]">{status.chain.chainId}</span>],
              ["CAIP-2", <span className="font-mono text-[0.8125rem]">{status.chain.caip2}</span>],
              ["Server version", <span className="font-mono text-[0.8125rem]">{status.version}</span>],
            ]}
          />
        </Panel>
        <Panel title={copy.sections.services}>
          <DataList
            rows={[
              ["API", <span className="flex flex-wrap items-center gap-3">{healthBadge(record.health)}</span>],
              [
                "Facilitator",
                <span className="flex flex-wrap items-center gap-3">
                  {healthBadge(record.facilitator)}
                  {record.facilitator.state === "ok" && record.facilitator.detail !== null ? <span className="font-mono text-[0.8125rem] text-muted">{record.facilitator.detail}</span> : null}
                </span>,
              ],
              [
                "Paid tools",
                <span className="flex flex-col gap-2">
                  <span>{status.paidTools.enabled ? <Badge tone="success">Enabled</Badge> : <Badge>Disabled</Badge>}</span>
                  {status.paidTools.reason === null ? null : <span className="text-muted">{status.paidTools.reason}</span>}
                </span>,
              ],
              [
                "Provisional releases",
                status.provisionalOverride ? <Badge tone="strong">Purchasable (override on)</Badge> : <span className="text-muted">Preview only, not purchasable</span>,
              ],
            ]}
          />
        </Panel>
      </div>

      <Panel title={copy.sections.contracts}>
        <DataList
          rows={[
            ["Warranty registry", <AddressValue value={status.registry} href={arbiscanAddress(status.registry)} />],
            ["USDC (test)", <AddressValue value={status.usdc} href={arbiscanToken(status.usdc)} />],
          ]}
        />
      </Panel>

      <Panel title={copy.sections.roles} aside={<span className="text-xs text-faint">public addresses only</span>}>
        <DataList
          rows={[
            [copy.roles.provider, <AddressValue value={status.provider} href={arbiscanAddress(status.provider)} />],
            [copy.roles.facilitator, <AddressValue value={status.facilitator} href={arbiscanAddress(status.facilitator)} />],
            [copy.roles.evaluator, <AddressValue value={status.evaluator} href={arbiscanAddress(status.evaluator)} />],
          ]}
        />
      </Panel>
    </div>
  );
}

export function StatusView({ state, onRetry }: { readonly state: ApiState<StatusRecord>; readonly onRetry?: () => void }) {
  return (
    <DashboardShell active="/status">
      <PageHeader label={copy.label} headline={copy.headline} lede={copy.lede} />
      <div className="mt-16 space-y-6 md:mt-24">
        <TrustNotice serverNotice={state.status === "ready" ? state.data.status.trust.notice : null} />
        {state.status === "loading" ? (
          <LoadingState rows={5} />
        ) : state.status === "error" ? (
          <ErrorState error={state.error} {...(onRetry === undefined ? {} : { onRetry })} />
        ) : (
          <StatusDetail record={state.data} />
        )}
      </div>
    </DashboardShell>
  );
}

export function StatusPage() {
  const { state, retry } = useApi("status", loadStatus);
  return <StatusView state={state} onRetry={retry} />;
}

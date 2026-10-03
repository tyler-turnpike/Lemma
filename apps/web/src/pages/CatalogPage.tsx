import type { ApiState } from "../api/client.js";
import { getJson } from "../api/client.js";
import { parseReleases } from "../api/parse.js";
import type { ReleaseSummary, ReleasesResponse } from "../api/types.js";
import { useApi } from "../api/useApi.js";
import { Badge } from "../components/dashboard/Badge.js";
import { DataList, ExternalLink, Hash, Stat } from "../components/dashboard/Fields.js";
import { DashboardShell, PageHeader } from "../components/dashboard/Shell.js";
import { ErrorState, LoadingState, MessageState } from "../components/dashboard/States.js";
import { dashboard, featured, featuredPath } from "../content.js";
import { formatDate, formatDuration, formatUsdcAtomic } from "../lib/format.js";
import { githubCommit, githubRepoLabel } from "../lib/links.js";
import { Link } from "../router.js";

const copy = dashboard.catalog;

/** Neutral either way: "benchmarked" names the evidence the price came from, not a verdict. */
export function EvidenceBadge({ evidence }: { readonly evidence: ReleaseSummary["evidence"] }) {
  return evidence.status === "benchmarked" ? (
    <Badge>
      {copy.evidence.benchmarked}
      {evidence.benchmarkVersion === null ? "" : ` · ${evidence.benchmarkVersion}`}
    </Badge>
  ) : (
    <Badge>{copy.evidence.provisional}</Badge>
  );
}

function versionKey(version: string): number[] {
  return version.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
}

function newerFirst(a: ReleaseSummary, b: ReleaseSummary): number {
  const [x, y] = [versionKey(a.version), versionKey(b.version)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The newest version of each release line is the one sold; older versions are kept for the record. */
export function splitCurrent(releases: readonly ReleaseSummary[]): { current: ReleaseSummary[]; earlier: ReleaseSummary[] } {
  const byName = new Map<string, ReleaseSummary[]>();
  for (const r of releases) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  const current: ReleaseSummary[] = [];
  const earlier: ReleaseSummary[] = [];
  for (const line of byName.values()) {
    const sorted = [...line].sort(newerFirst);
    current.push(sorted[0]!);
    earlier.push(...sorted.slice(1));
  }
  return { current, earlier };
}

function profileLine(release: ReleaseSummary): string {
  const p = release.supportedProfile;
  return [p.languages.join(" / "), p.moduleSystems.join(" / "), p.packageManagers.join(" / "), p.testRunners.join(" / ")].join(" · ");
}

function ReleaseCard({ release, superseded = false }: { readonly release: ReleaseSummary; readonly superseded?: boolean }) {
  const commitHref = githubCommit(release.provenance.upstreamRepo, release.provenance.commit);
  const repoLabel = githubRepoLabel(release.provenance.upstreamRepo) ?? release.provenance.upstreamRepo;
  const exact = Object.entries(release.supportedProfile.exact);
  const evidence = release.evidence;

  return (
    <article className="min-w-0 rounded-md border border-line bg-card" aria-labelledby={`release-${release.id}`}>
      <div className="flex flex-col gap-4 px-5 pt-6 pb-5 md:flex-row md:items-start md:justify-between md:px-6">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">{release.id}</p>
          <h2 id={`release-${release.id}`} className="mt-2 text-xl text-fg">
            {release.title}
          </h2>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          {superseded ? <Badge>{copy.evidence.superseded}</Badge> : <EvidenceBadge evidence={evidence} />}
          {!superseded && evidence.status === "benchmarked" ? (
            <p className="max-w-sm text-xs leading-relaxed text-muted md:text-right">
              {copy.evidence.published}{" "}
              <Link href="/benchmark" className="text-fg underline decoration-line underline-offset-4 transition-colors hover:text-mint hover:decoration-mint">
                {copy.evidence.publishedLink}
              </Link>
            </p>
          ) : null}
        </div>
      </div>
      <p className="max-w-3xl px-5 pb-6 leading-relaxed text-muted md:px-6">{release.summary}</p>
      {/* Only the release that was actually bought links to the live purchase. */}
      {release.id === featured.release ? (
        <p className="-mt-2 px-5 pb-6 text-sm md:px-6">
          <Link href={featuredPath} className="text-fg transition-colors hover:text-mint">
            {copy.evidence.livePurchase} <span aria-hidden="true">→</span>
          </Link>
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-px border-y border-line bg-line md:grid-cols-4">
        <Stat label={copy.fields.price} value={formatUsdcAtomic(release.priceAtomic)} note="refunded in full on failure" />
        <Stat label={copy.fields.bond} value={formatUsdcAtomic(release.bondAtomic)} note="on deposit · covers refunds" />
        <Stat label={copy.fields.claimWindow} value={formatDuration(release.claimWindowSeconds)} note="after activation" />
        <Stat label={copy.fields.expires} value={formatDate(release.expiresAt)} note="release expiry" />
      </div>

      <DataList
        rows={[
          [copy.fields.taskKind, <span className="font-mono text-[0.8125rem]">{release.taskKind}</span>],
          [copy.fields.license, release.provenance.spdxLicense],
          [
            copy.fields.provenance,
            <span className="flex flex-col gap-1">
              <ExternalLink href={commitHref} className="font-mono text-[0.8125rem]">
                {repoLabel}@{release.provenance.commit.slice(0, 7)}
              </ExternalLink>
              <span className="text-muted">{release.provenance.attribution}</span>
            </span>,
          ],
          [copy.fields.profile, profileLine(release)],
          [
            copy.fields.exact,
            exact.length === 0 ? (
              <span className="text-faint">—</span>
            ) : (
              <span className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.8125rem]">
                {exact.map(([name, version]) => (
                  <span key={name}>
                    {name}
                    <span className="text-muted">@{version}</span>
                  </span>
                ))}
              </span>
            ),
          ],
          [copy.fields.files, `${release.fileCount} file operation${release.fileCount === 1 ? "" : "s"}`],
          [copy.fields.payloadDigest, <Hash value={release.payloadDigest} />],
          ...(evidence.status === "benchmarked" && evidence.expectedSavingAtomic !== null
            ? [[copy.fields.expectedSaving, `${formatUsdcAtomic(evidence.expectedSavingAtomic)} · benchmark ${evidence.benchmarkVersion ?? "—"}`] as const]
            : []),
        ]}
      />

      {release.limitations.length === 0 ? null : (
        <div className="border-t border-line px-5 py-5 md:px-6">
          <h3 className="text-sm text-muted">{copy.fields.limitations}</h3>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-fg">
            {release.limitations.map((limitation, i) => (
              <li key={i} className="flex gap-3">
                <span aria-hidden="true" className="mt-[0.6em] h-px w-2.5 shrink-0 bg-faint" />
                <span className="min-w-0">{limitation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function ReleaseList({ releases }: { readonly releases: readonly ReleaseSummary[] }) {
  const { current, earlier } = splitCurrent(releases);
  return (
    <>
      <p className="mb-6 text-sm text-muted" data-state="ready">
        {current.length} release{current.length === 1 ? "" : "s"} on sale · {dashboard.testnetTag}
      </p>
      <div className="grid gap-8">
        {current.map((release) => (
          <ReleaseCard key={release.id} release={release} />
        ))}
      </div>
      {earlier.length === 0 ? null : (
        <details className="group mt-12 rounded-md border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm text-muted transition-colors hover:text-fg md:px-6">
            <span>
              {copy.earlier.title} · {earlier.length}
            </span>
            <span aria-hidden="true" className="transition-transform group-open:rotate-90">
              ›
            </span>
          </summary>
          <p className="border-t border-line px-5 py-4 text-sm leading-relaxed text-muted md:px-6">{copy.earlier.body}</p>
          <div className="grid gap-8 border-t border-line p-5 md:p-6">
            {earlier.map((release) => (
              <ReleaseCard key={release.id} release={release} superseded />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

export function CatalogView({ state, onRetry }: { readonly state: ApiState<ReleasesResponse>; readonly onRetry?: () => void }) {
  return (
    <DashboardShell active="/catalog">
      <PageHeader label={copy.label} headline={copy.headline} lede={copy.lede} />
      <div className="mt-16 md:mt-24">
        {state.status === "loading" ? (
          <LoadingState rows={4} />
        ) : state.status === "error" ? (
          <ErrorState error={state.error} {...(onRetry === undefined ? {} : { onRetry })} />
        ) : state.data.releases.length === 0 ? (
          <MessageState state="empty" title={copy.empty.title} body={copy.empty.body} />
        ) : (
          <>
            <ReleaseList releases={state.data.releases} />
          </>
        )}
      </div>
    </DashboardShell>
  );
}

export function CatalogPage() {
  const { state, retry } = useApi("releases", (signal) => getJson("/api/v1/releases", parseReleases, { signal }));
  return <CatalogView state={state} onRetry={retry} />;
}

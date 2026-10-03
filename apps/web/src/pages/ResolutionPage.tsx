import { useState, type FormEvent, type ReactNode } from "react";

import { ApiError, getJson, type ApiState } from "../api/client.js";
import { parseReceipts, parseResolution } from "../api/parse.js";
import type { AdoptionOutcome, AdoptionReceiptsResponse, ResolutionSummary } from "../api/types.js";
import { useApi } from "../api/useApi.js";
import { Badge } from "../components/dashboard/Badge.js";
import { DataList, ExternalLink, Hash } from "../components/dashboard/Fields.js";
import { DashboardShell, PageHeader, Panel } from "../components/dashboard/Shell.js";
import { ErrorState, LoadingState, MessageState } from "../components/dashboard/States.js";
import { PillLink } from "../components/PillLink.js";
import { dashboard, featured, featuredPath } from "../content.js";
import { formatDateTime, formatUsdcAtomic, unixSecondsToIso } from "../lib/format.js";
import { arbiscanAddress, arbiscanTx } from "../lib/links.js";
import { Link, navigate } from "../router.js";

const copy = dashboard.resolution;

export const RESOLUTION_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export interface ResolutionRecord {
  readonly summary: ResolutionSummary;
  /** Null when the receipts endpoint could not be read; the summary still carries counts. */
  readonly receipts: AdoptionReceiptsResponse | null;
}

export async function loadResolution(id: string, signal: AbortSignal): Promise<ResolutionRecord> {
  const summary = await getJson(`/api/v1/resolutions/${id}`, parseResolution, { signal });
  let receipts: AdoptionReceiptsResponse | null = null;
  try {
    receipts = await getJson(`/api/v1/adoption-receipts?resolutionId=${id}`, parseReceipts, { signal });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
  return { summary, receipts };
}

// ---- warranty + step derivation -------------------------------------------------------

type Tone = "neutral" | "success" | "strong";

export function warrantyState(summary: ResolutionSummary, now: number): { readonly label: string; readonly tone: Tone; readonly detail: string } {
  if (summary.voucher === null) {
    return summary.status === "pending"
      ? { label: "Not issued", tone: "neutral", detail: "Payment has not settled, so no warranty voucher exists." }
      : { label: "Voucher pending", tone: "neutral", detail: "Payment settled; the provider voucher has not been recorded yet." };
  }
  const deadline = unixSecondsToIso(summary.voucher.voucher.expiresAt);
  const open = deadline !== null && Date.parse(deadline) > now;
  if (summary.receipts.latestOutcome === "failed") {
    return { label: "Failure reported", tone: "strong", detail: "The buyer reported a failed adoption. A refund from the provider bond requires the evaluator to confirm the failure onchain." };
  }
  return open
    ? { label: "Activation window open", tone: "neutral", detail: `Activation possible until ${formatDateTime(deadline)}.` }
    : { label: "Activation window closed", tone: "neutral", detail: `Vouchers are activated right after purchase; this one could be activated until ${formatDateTime(deadline)}. The registry on Arbiscan records whether it was.` };
}

const outcomeTone: Record<AdoptionOutcome, Tone> = { passed: "success", failed: "strong", abandoned: "neutral" };
const outcomeLabel: Record<AdoptionOutcome, string> = { passed: "Passed", failed: "Failed", abandoned: "Abandoned" };

function Step({ index, label, badge, note }: { readonly index: number; readonly label: string; readonly badge: ReactNode; readonly note: string }) {
  return (
    <li className="min-w-0 bg-card px-5 py-5 md:px-6">
      <p className="flex items-center gap-2 text-xs text-muted">
        <span className="font-mono text-faint">0{index}</span>
        {label}
      </p>
      <div className="mt-3">{badge}</div>
      <p className="mt-2 text-xs text-faint">{note}</p>
    </li>
  );
}

function Steps({ summary }: { readonly summary: ResolutionSummary }) {
  const outcome = summary.receipts.latestOutcome;
  return (
    <ol className="grid gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-3">
      <Step
        index={1}
        label={copy.steps.payment}
        badge={summary.status === "settled" ? <Badge tone="success">Settled</Badge> : <Badge>Pending</Badge>}
        note={summary.payment === null ? "No settlement recorded" : formatDateTime(summary.payment.settledAt)}
      />
      <Step
        index={2}
        label={copy.steps.voucher}
        badge={summary.voucher === null ? <Badge>Not issued</Badge> : <Badge tone="success">Signed</Badge>}
        note={summary.voucher === null ? "Issued after settlement" : `Activate by ${formatDateTime(unixSecondsToIso(summary.voucher.voucher.expiresAt))}`}
      />
      <Step
        index={3}
        label={copy.steps.receipt}
        badge={outcome === null ? <Badge>Awaiting</Badge> : <Badge tone={outcomeTone[outcome]}>{outcomeLabel[outcome]}</Badge>}
        note={summary.receipts.count === 0 ? "Buyer has not reported" : `${summary.receipts.count} receipt${summary.receipts.count === 1 ? "" : "s"} · latest ${formatDateTime(summary.receipts.latestAt)}`}
      />
    </ol>
  );
}

function Address({ value }: { readonly value: string | null }) {
  return <Hash value={value} href={arbiscanAddress(value)} />;
}

function Receipts({ record }: { readonly record: ResolutionRecord }) {
  const list = record.receipts?.receipts ?? [];
  if (list.length === 0) {
    return <p className="px-5 py-5 text-sm text-muted md:px-6">{record.summary.receipts.count === 0 ? copy.noReceipts : `${record.summary.receipts.count} receipt(s) recorded; details unavailable.`}</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {list.map((receipt) => (
        <li key={receipt.receiptId} className="grid gap-4 px-5 py-5 text-sm md:grid-cols-[10rem_1fr_auto] md:items-center md:px-6">
          <span className="justify-self-start">
            <Badge tone={outcomeTone[receipt.outcome]}>{outcomeLabel[receipt.outcome]}</Badge>
          </span>
          <div className="min-w-0 space-y-1">
            <p className="font-mono text-[0.8125rem] text-fg">
              {receipt.testSummary.passed} passed · {receipt.testSummary.failed} failed · {receipt.testSummary.skipped} skipped
              <span className="text-muted"> · {(receipt.testSummary.durationMs / 1000).toFixed(1)}s · {receipt.filesChanged} files changed</span>
            </p>
            <p className="text-muted">
              Evidence <Hash value={receipt.evidenceDigest} />
            </p>
          </div>
          <p className="text-xs text-faint md:text-right">Signed by buyer · {formatDateTime(receipt.signedAt)}</p>
        </li>
      ))}
    </ul>
  );
}

function ResolutionDetail({ record, now }: { readonly record: ResolutionRecord; readonly now: number }) {
  const { summary } = record;
  const warranty = warrantyState(summary, now);
  const voucher = summary.voucher;
  return (
    <div className="space-y-6" data-state="ready">
      <Steps summary={summary} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={copy.sections.summary}>
          <DataList
            rows={[
              ["Release", <span className="font-mono text-[0.8125rem]">{summary.release}</span>],
              ["Release id", <Hash value={summary.releaseId} />],
              ["Price", formatUsdcAtomic(summary.priceAtomic)],
              ["Buyer", <Address value={summary.buyer} />],
              ["Payload digest", <Hash value={summary.payloadDigest} />],
              ["Issued", formatDateTime(summary.issuedAt)],
              ["Delivery expires", formatDateTime(summary.expiresAt)],
            ]}
          />
        </Panel>

        <Panel title={copy.sections.payment} aside={summary.payment === null ? <Badge>Pending</Badge> : <Badge tone="success">Settled</Badge>}>
          {summary.payment === null ? (
            <p className="px-5 py-5 text-sm text-muted md:px-6">No settlement recorded. A pending resolution has not been paid.</p>
          ) : (
            <DataList
              rows={[
                ["Transaction", <Hash value={summary.payment.txHash} href={arbiscanTx(summary.payment.txHash)} />],
                ["Amount", formatUsdcAtomic(summary.payment.amountAtomic)],
                ["Payer", <Address value={summary.payment.payer} />],
                ["Network", <span className="font-mono text-[0.8125rem]">{summary.payment.network}</span>],
                ["Settled", formatDateTime(summary.payment.settledAt)],
              ]}
            />
          )}
        </Panel>

        <Panel title={copy.sections.voucher} aside={voucher === null ? <Badge>Not issued</Badge> : <Badge tone="success">Signed</Badge>}>
          {voucher === null ? (
            <p className="px-5 py-5 text-sm text-muted md:px-6">The provider signs a voucher only after payment settles.</p>
          ) : (
            <DataList
              rows={[
                ["Signer (provider)", <Address value={voucher.signer} />],
                ["Registry", <Address value={voucher.verifyingContract} />],
                ["Chain id", <span className="font-mono text-[0.8125rem]">{voucher.chainId}</span>],
                ["Amount", formatUsdcAtomic(voucher.voucher.amount)],
                ["Payment hash", <Hash value={voucher.voucher.paymentHash} href={arbiscanTx(voucher.voucher.paymentHash)} />],
                ["Payload digest", <Hash value={voucher.voucher.payloadDigest} />],
                ["Activate by", formatDateTime(unixSecondsToIso(voucher.voucher.expiresAt))],
                ["Signature", <Hash value={voucher.signature} />],
              ]}
            />
          )}
        </Panel>

        <Panel title={copy.sections.warranty} aside={<Badge tone={warranty.tone}>{warranty.label}</Badge>}>
          <div className="space-y-4 px-5 py-5 text-sm leading-relaxed md:px-6">
            <p className="text-fg">{warranty.detail}</p>
            <p className="text-muted">{copy.warrantyNote}</p>
            {voucher === null ? null : (
              <ExternalLink href={arbiscanAddress(voucher.verifyingContract)}>View registry on Arbiscan</ExternalLink>
            )}
          </div>
        </Panel>
      </div>

      <Panel title={copy.sections.receipts}>
        <Receipts record={record} />
      </Panel>
    </div>
  );
}

export function ResolutionView({ id, state, onRetry, now = Date.now() }: {
  readonly id: string;
  readonly state: ApiState<ResolutionRecord>;
  readonly onRetry?: () => void;
  readonly now?: number;
}) {
  const valid = RESOLUTION_ID_RE.test(id);
  const ready = valid && state.status === "ready" ? state.data.summary : null;
  const headline: readonly [string, string] = ready === null ? ["Compatibility Resolution", "payment to outcome"] : [ready.release, `${ready.status} · ${formatUsdcAtomic(ready.priceAtomic)}`];

  return (
    <DashboardShell active="/resolutions">
      <PageHeader label={copy.label} headline={headline} lede={copy.lede}>
        <p className="mt-6 font-mono text-xs break-all text-faint">{id}</p>
      </PageHeader>
      <div className="mt-16 md:mt-24">
        {!valid ? (
          <MessageState state="invalid_input" tag="400" title={copy.invalid.title} body={copy.invalid.body}>
            <WaysForward />
          </MessageState>
        ) : state.status === "loading" ? (
          <LoadingState rows={5} />
        ) : state.status === "error" ? (
          <ErrorState
            error={state.error}
            notFound={state.error.kind === "invalid_input" ? copy.invalid : copy.notFound}
            notFoundActions={<WaysForward />}
            {...(onRetry === undefined ? {} : { onRetry })}
          />
        ) : (
          <ResolutionDetail record={state.data} now={now} />
        )}
      </div>
    </DashboardShell>
  );
}

/** Dead ends get two ways out: another lookup, or the live demo resolution. */
function WaysForward() {
  return (
    <>
      <PillLink href="/resolutions" variant="secondary">
        {copy.lookup.another}
      </PillLink>
      <PillLink href={featuredPath}>{copy.lookup.demo.label}</PillLink>
    </>
  );
}

export function ResolutionPage({ id }: { readonly id: string }) {
  const valid = RESOLUTION_ID_RE.test(id);
  const { state, retry } = useApi(valid ? id.toLowerCase() : null, (signal) => loadResolution(id.toLowerCase(), signal));
  return <ResolutionView id={id} state={state} onRetry={retry} />;
}

export function ResolutionLookupPage() {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = value.trim();
    if (!RESOLUTION_ID_RE.test(id)) {
      setInvalid(true);
      return;
    }
    navigate(`/resolutions/${id.toLowerCase()}`);
  };
  return (
    <DashboardShell active="/resolutions">
      <PageHeader label={copy.label} headline={copy.lookup.headline} lede={copy.lookup.lede} />
      <form onSubmit={submit} className="mt-16 md:mt-24" noValidate>
        <label htmlFor="resolution-id" className="text-sm text-muted">
          Resolution id
        </label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            id="resolution-id"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setInvalid(false);
            }}
            placeholder={copy.lookup.placeholder}
            spellCheck={false}
            autoComplete="off"
            maxLength={80}
            aria-invalid={invalid}
            aria-describedby={invalid ? "resolution-id-error" : undefined}
            className="h-11 min-w-0 flex-1 rounded-full border border-line bg-card px-5 font-mono text-sm text-fg placeholder:text-faint focus:border-mint focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint"
          />
          <button type="submit" className="inline-flex h-11 items-center justify-center rounded-full bg-mint px-6 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-mint-strong">
            {copy.lookup.submit}
          </button>
        </div>
        {invalid ? (
          <p id="resolution-id-error" role="alert" className="mt-3 text-sm text-fg">
            {copy.lookup.invalid}
          </p>
        ) : null}
      </form>
      <section aria-labelledby="demo-title" className="mt-10 rounded-md border border-line bg-card px-5 py-6 md:px-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-10">
          <div className="min-w-0">
            <h2 id="demo-title" className="flex flex-wrap items-center gap-3 text-lg text-fg">
              {copy.lookup.demo.label}
              <Badge tone="success">Settled</Badge>
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{copy.lookup.demo.body}</p>
            <p className="mt-3 font-mono text-xs break-all text-faint">
              {featured.release} · {featured.resolutionId}
            </p>
          </div>
          <Link
            href={featuredPath}
            className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-full border border-line pr-4 pl-5 text-[0.9375rem] font-medium text-fg transition-colors hover:border-mint hover:text-mint md:self-center"
          >
            {copy.lookup.demo.cta} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </DashboardShell>
  );
}

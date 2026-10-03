import type { ReactNode } from "react";

import type { ApiFailure } from "../../api/client.js";
import { dashboard } from "../../content.js";

const copy = dashboard.states;

/** Skeleton rows standing in for content while a request is in flight. */
export function LoadingState({ rows = 3, label = copy.loading }: { readonly rows?: number; readonly label?: string }) {
  return (
    <div role="status" aria-live="polite" className="rounded-md border border-line bg-card" data-state="loading">
      <span className="sr-only">{label}…</span>
      <div className="flex items-center gap-3 border-b border-line px-5 py-4 text-sm text-muted md:px-6">
        <span aria-hidden="true" className="inline-block size-3 animate-spin rounded-full border border-faint border-t-fg motion-reduce:animate-none" />
        {label}
      </div>
      <div aria-hidden="true" className="divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex gap-6 px-5 py-4 md:px-6">
            <span className="h-3 w-24 animate-pulse rounded-full bg-[#1b2729] motion-reduce:animate-none" />
            <span className="h-3 flex-1 animate-pulse rounded-full bg-[#1b2729] motion-reduce:animate-none" style={{ maxWidth: `${60 - i * 10}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Centered message block used for empty, error and offline states. */
export function MessageState({ title, body, children, tag, state, heading = false }: {
  readonly title: string;
  /** Render the title as the page's h1 (pages with no other header). */
  readonly heading?: boolean;
  readonly body: ReactNode;
  readonly children?: ReactNode;
  readonly tag?: string;
  readonly state: string;
}) {
  return (
    <div data-state={state} className="rounded-md border border-line bg-card px-6 py-14 text-center md:py-20">
      {tag === undefined ? null : <p className="font-mono text-xs text-faint">{tag}</p>}
      {heading ? <h1 className="mt-2 text-xl text-fg">{title}</h1> : <p className="mt-2 text-xl text-fg">{title}</p>}
      <div className="mx-auto mt-3 max-w-lg text-[0.9375rem] leading-relaxed text-muted">{body}</div>
      {children === undefined ? null : <div className="mt-8 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}

export function RetryButton({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="inline-flex h-10 items-center gap-2 rounded-full bg-fg px-5 text-[0.9375rem] font-medium text-bg transition-opacity hover:opacity-85"
    >
      {copy.retry}
    </button>
  );
}

/**
 * Generic failure presentation. Pages handle not_found / invalid_input themselves when the
 * message should be specific; everything else lands here.
 */
export function ErrorState({ error, onRetry, notFound, notFoundActions }: {
  readonly error: ApiFailure;
  readonly onRetry?: () => void;
  readonly notFound?: { readonly title: string; readonly body: string };
  /** Ways forward shown under a not-found or invalid-input message. */
  readonly notFoundActions?: ReactNode;
}) {
  const retry = onRetry === undefined ? undefined : <RetryButton onRetry={onRetry} />;
  switch (error.kind) {
    case "offline":
      return (
        <MessageState state="offline" tag="GET /api/v1" title={copy.offline.title} body={copy.offline.body}>
          {retry}
        </MessageState>
      );
    case "not_found":
    case "invalid_input":
      return (
        <MessageState state={error.kind} tag={error.kind === "not_found" ? "404" : "400"} title={notFound?.title ?? "Not found"} body={notFound?.body ?? ""}>
          {notFoundActions}
        </MessageState>
      );
    case "rate_limited":
      return (
        <MessageState state="rate_limited" tag="429" title={copy.rateLimited.title} body={copy.rateLimited.body}>
          {retry}
        </MessageState>
      );
    case "unavailable":
      return (
        <MessageState state="unavailable" tag={`HTTP ${error.status}${error.code === null ? "" : ` · ${error.code}`}`} title={copy.unavailable.title} body={copy.unavailable.body}>
          {retry}
        </MessageState>
      );
    case "bad_response":
      return (
        <MessageState state="bad_response" title={copy.badResponse.title} body={copy.badResponse.body}>
          {retry}
        </MessageState>
      );
  }
}

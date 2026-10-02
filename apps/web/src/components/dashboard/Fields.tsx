import type { ReactNode } from "react";

import { safeExternalHref } from "../../lib/links.js";
import { shortHex } from "../../lib/format.js";

/** Renders an outbound link only when the href passes the allowlist; otherwise plain text. */
export function ExternalLink({ href, children, className = "" }: { readonly href: string | null; readonly children: ReactNode; readonly className?: string }) {
  const safe = safeExternalHref(href);
  if (safe === null) return <span className={className}>{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 text-fg underline decoration-line underline-offset-4 transition-colors hover:decoration-fg ${className}`}>
      {children}
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3 shrink-0 text-muted">
        <path d="M5.5 10.5 10.5 5.5M6.5 5.5h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

/** Monospace hex value, shortened, with the full value on hover and for screen readers. */
export function Hash({ value, href = null, full = false }: { readonly value: string | null; readonly href?: string | null; readonly full?: boolean }) {
  if (value === null || value === "") return <span className="text-faint">—</span>;
  const text = full ? value : shortHex(value, 10, 8);
  return (
    <span title={value} className="font-mono text-[0.8125rem] break-all">
      {href === null ? <span className="text-fg">{text}</span> : <ExternalLink href={href}>{text}</ExternalLink>}
      {text !== value ? <span className="sr-only"> ({value})</span> : null}
    </span>
  );
}

/** Hairline-separated term / value rows. */
export function DataList({ rows }: { readonly rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([term, value]) => (
        <div key={term} className="grid gap-1 px-5 py-3.5 text-sm sm:grid-cols-[12rem_1fr] sm:gap-6 md:px-6">
          <dt className="text-muted">{term}</dt>
          <dd className="min-w-0 break-words text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Large figure with a muted caption, as used in stat strips. */
export function Stat({ label, value, note }: { readonly label: string; readonly value: ReactNode; readonly note?: ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-5 py-5 md:px-6">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 font-mono text-lg text-fg tabular-nums break-words">{value}</p>
      {note === undefined ? null : <p className="mt-1 text-xs text-faint">{note}</p>}
    </div>
  );
}

import type { ReactNode } from "react";

import { dashboard } from "../../content.js";
import { Link } from "../../router.js";

/** Dashboard page frame: clears the fixed nav, shows the section tabs, then the page. */
export function DashboardShell({ active, children }: { readonly active: string | null; readonly children: ReactNode }) {
  return (
    <div className="pt-[72px]">
      <div className="border-b border-line">
        <nav aria-label="Dashboard" className="container-page flex items-center gap-6 overflow-x-auto">
          <ul className="flex shrink-0 items-center gap-5 md:gap-7">
            {dashboard.tabs.map((tab) => {
              const current = tab.href === active;
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={current ? "page" : undefined}
                    className={`-mb-px inline-flex h-12 items-center border-b text-sm transition-colors ${
                      current ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
                    }`}
                  >
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <span className="ml-auto hidden shrink-0 text-xs text-faint sm:block">{dashboard.testnetTag}</span>
        </nav>
      </div>
      <div className="container-page pt-16 pb-24 md:pt-24 md:pb-40">{children}</div>
    </div>
  );
}

/** Two-column header in the landing page's SectionHeader language; the label is the page h1. */
export function PageHeader({ label, headline, lede, children }: {
  readonly label: string;
  readonly headline: readonly [string, string];
  readonly lede: string;
  readonly children?: ReactNode;
}) {
  return (
    <header className="grid gap-6 md:grid-cols-2 md:gap-12">
      <h1 className="text-section text-fg">{label}</h1>
      <div className="min-w-0">
        <p className="text-section">
          <span className="block break-words text-fg">{headline[0]}</span>
          <span className="block break-words text-muted">{headline[1]}</span>
        </p>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted md:mt-10">{lede}</p>
        {children}
      </div>
    </header>
  );
}

/** Bordered card with an optional hairline-separated title row. */
export function Panel({ title, aside, children, className = "" }: {
  readonly title?: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-md border border-line bg-card ${className}`}>
      {title === undefined ? null : (
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 md:px-6">
          <h2 className="text-sm text-fg">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

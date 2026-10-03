import { useState } from "react";

import { pricing } from "../content.js";
import { formatUsdcAtomic } from "../lib/format.js";
import { QUOTE_MODELS, browserQuote, type QuoteModel } from "../lib/quote.js";
import { SectionHeader } from "./SectionHeader.js";

function Row({ label, value, note, strong = false }: { readonly label: string; readonly value: string; readonly note: string; readonly strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 px-5 py-4 md:px-6">
      <div className="min-w-0">
        <p className="text-sm text-fg">{label}</p>
        <p className="mt-0.5 text-xs text-muted">{note}</p>
      </div>
      <p className={`shrink-0 font-mono tabular-nums ${strong ? "text-lg text-mint" : "text-fg"}`}>{value}</p>
    </div>
  );
}

export function Pricing() {
  const [model, setModel] = useState<QuoteModel>("gpt-5.6-terra");
  const q = browserQuote(model);
  const keep = q.expectedSavingAtomic === 0n ? 0 : Number(((q.expectedSavingAtomic - q.totalAtomic) * 100n) / q.expectedSavingAtomic);
  return (
    <section aria-labelledby="pricing-title" className="py-24 md:py-40">
      <div className="container-page">
        <SectionHeader id="pricing-title" label={pricing.label} headline={pricing.headline} lede={pricing.lede} />
        <div className="mt-16 grid gap-6 md:mt-24 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0">
            <p className="text-sm text-muted">{pricing.pick}</p>
            <div role="radiogroup" aria-label={pricing.pick} className="mt-4 flex flex-wrap gap-2">
              {QUOTE_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={m.id === model}
                  onClick={() => setModel(m.id)}
                  className={`rounded-full px-3.5 py-1.5 font-mono text-[0.8125rem] transition-colors ${
                    m.id === model ? "bg-fg text-bg" : "border border-line text-muted hover:border-muted hover:text-fg"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-faint">{pricing.footnote}</p>
          </div>
          <div className="min-w-0 divide-y divide-line rounded-md border border-line bg-card" aria-live="polite">
            <div className="flex items-center justify-between gap-4 px-5 py-4 md:px-6">
              <p className="font-mono text-xs text-muted">{pricing.release}</p>
              <p className="font-mono text-xs text-muted">{model}</p>
            </div>
            <Row label={pricing.rows.saving} value={formatUsdcAtomic(q.expectedSavingAtomic.toString())} note={pricing.notes.saving} />
            <Row label={pricing.rows.upFront} value={formatUsdcAtomic(q.floorAtomic.toString())} note={pricing.notes.upFront} />
            <Row label={pricing.rows.onSuccess} value={formatUsdcAtomic(q.successFeeAtomic.toString())} note={pricing.notes.onSuccess} />
            <Row label={pricing.rows.total} value={formatUsdcAtomic(q.totalAtomic.toString())} note={`${pricing.notes.total} ${keep}% ${pricing.notes.keep}`} strong />
          </div>
        </div>
      </div>
    </section>
  );
}

import { decisionCard } from "./mockScript.js";

export function DecisionCard() {
  return (
    <div className="w-full max-w-[20rem] rounded-xl border border-line bg-[#131c1e]/95 p-3 font-sans shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.6875rem] text-muted">Lemma · preview</span>
        <span className="rounded-full bg-mint-soft px-2 py-0.5 font-mono text-[0.625rem] font-medium tracking-wide text-mint">
          {decisionCard.decision}
        </span>
      </div>
      <p className="mt-2 font-mono text-xs text-fg">{decisionCard.release}</p>
      <dl className="mt-2 space-y-0.5 border-t border-line pt-2 text-[0.6875rem] leading-[1.45]">
        {decisionCard.rows.map(([term, value]) => (
          <div key={term} className="flex justify-between gap-4">
            <dt className="text-muted">{term}</dt>
            <dd className="text-right text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[0.625rem] text-faint">{decisionCard.footnote}</p>
    </div>
  );
}

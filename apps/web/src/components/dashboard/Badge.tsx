import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "strong";

const tones: Record<Tone, string> = {
  // Outline pill for anything that is not a confirmed success.
  neutral: "border border-line text-muted",
  // Signal green is reserved for success states (benchmarked, settled, passed, healthy).
  success: "bg-signal/15 text-signal",
  // Solid white for states that need attention without implying success.
  strong: "bg-fg text-bg",
};

export function Badge({ tone = "neutral", children }: { readonly tone?: Tone; readonly children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}>
      {tone === "success" ? <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" /> : null}
      {children}
    </span>
  );
}

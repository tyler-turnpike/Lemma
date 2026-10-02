// Every user-facing string on the landing page lives here.
// Bracketed values are placeholders until the pitch wording is decided.

export interface NavLink {
  readonly label: string;
  readonly href: string;
}

export interface RulerSpec {
  /** Value at the left edge of the strip when the page loads. */
  readonly start: number;
  /** Value change per tick; negative values count down as the strip moves. */
  readonly perTick: number;
  /** Ticks between labels. */
  readonly labelEvery: number;
  /** Strip speed in pixels per second. */
  readonly speed: number;
  readonly unit: "tokens" | "usd";
}

export const nav = {
  links: [
    { label: "Docs", href: "#" },
    { label: "Catalog", href: "#" },
    { label: "Status", href: "#" },
    { label: "GitHub", href: "#" },
  ] satisfies readonly NavLink[],
  cta: { label: "[Get started]", href: "#" } satisfies NavLink,
} as const;

export const hero = {
  eyebrow: "[Meet Lemma]",
  positioning: "[One-line positioning]",
  headline: ["[Headline line one,]", "[headline line two]"],
  // Illustrative values only. What each ruler represents is an open copy decision.
  rulers: {
    top: { start: 1_200_000, perTick: 25_000, labelEvery: 4, speed: 22, unit: "tokens" },
    bottom: { start: 9.8, perTick: -0.01, labelEvery: 4, speed: 22, unit: "usd" },
  } satisfies Record<string, RulerSpec>,
} as const;

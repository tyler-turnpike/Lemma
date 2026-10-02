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

export const mock = {
  label: "[Section label]",
  headline: ["[Product headline,]", "[second line]"],
  lede: "[Short paragraph describing what the visitor is watching: an agent asking Lemma before it writes code.]",
  replay: "Replay",
} as const satisfies { label: string; headline: readonly [string, string]; lede: string; replay: string };

export const guarantees = {
  label: "[Guarantees]",
  headline: ["[Guarantees headline,]", "[second line]"],
  lede: "[Short paragraph: what Lemma guarantees before, during and after an agent pays.]",
  cards: [
    { key: "privacy", title: "[Privacy]", body: "[Two lines on sending a repository profile, never source code.]", href: "#" },
    { key: "spend", title: "[Spend caps]", body: "[Two lines on per-resolution and daily limits enforced outside the model.]", href: "#" },
    { key: "warranty", title: "[Bonded warranty]", body: "[Two lines on eligible failures being refunded from the provider bond.]", href: "#" },
  ],
  learnMore: "Learn more",
} as const;

export const closing = {
  headline: ["[Closing line one,]", "[closing line two]"],
  cta: { label: "[Get started]", href: "#" } satisfies NavLink,
} as const;

export const footer = {
  columns: [
    { title: "[Product]", links: [{ label: "[Catalog]", href: "#" }, { label: "[Status]", href: "#" }] },
    { title: "[Developers]", links: [{ label: "[Docs]", href: "#" }, { label: "[GitHub]", href: "#" }] },
    { title: "[Project]", links: [{ label: "[Benchmark]", href: "#" }, { label: "[Security model]", href: "#" }] },
  ],
  copyright: "© 2026 Lemma",
  network: "Runs on Arbitrum Sepolia testnet",
} as const;

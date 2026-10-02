// Every user-facing string on the landing page lives here.
// First-draft pitch copy; claims must stay within docs/demo-script.md "Claims to avoid".

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
  cta: { label: "Get started", href: "#" } satisfies NavLink,
} as const;

export const hero = {
  eyebrow: "Meet Lemma",
  positioning: "Verified integration work for coding agents",
  headline: ["Stop paying agents", "to rediscover solved work"],
  // Illustrative values only. What each ruler represents is an open copy decision.
  rulers: {
    top: { start: 1_200_000, perTick: 25_000, labelEvery: 4, speed: 22, unit: "tokens" },
    bottom: { start: 9.8, perTick: -0.01, labelEvery: 4, speed: 22, unit: "usd" },
  } satisfies Record<string, RulerSpec>,
} as const;

export const mock = {
  label: "In use",
  headline: ["Ask before building,", "pay only when it fits"],
  lede: "Before writing code, the agent asks Lemma whether verified prior work fits this repository. The preview is free. If it fits, the bridge pays a few cents in USDC, applies the patch and runs the pinned tests.",
  replay: "Replay",
} as const satisfies { label: string; headline: readonly [string, string]; lede: string; replay: string };

export const guarantees = {
  label: "Guarantees",
  headline: ["Recourse, not reputation,", "on every purchase"],
  lede: "Your code stays local, your agent cannot overspend, and a failed adoption costs the provider, not you.",
  cards: [
    { key: "privacy", title: "Your source stays local", body: "The bridge sends an allowlisted profile: languages, versions and a lockfile digest. Never your code.", href: "#" },
    { key: "spend", title: "Caps the model can't move", body: "Per-resolution and daily limits are checked in code before anything is signed. No prompt can raise them.", href: "#" },
    { key: "warranty", title: "Bonded warranty", body: "Each paid resolution reserves provider bond. An evaluator-confirmed failure within 72 hours is refunded from it.", href: "#" },
  ],
  learnMore: "Learn more",
} as const;

export const closing = {
  headline: ["Stop rediscovering,", "start reusing"],
  cta: { label: "Install the bridge", href: "#" } satisfies NavLink,
} as const;

export const footer = {
  columns: [
    { title: "Product", links: [{ label: "Catalog", href: "#" }, { label: "Status", href: "#" }] },
    { title: "Developers", links: [{ label: "Docs", href: "#" }, { label: "GitHub", href: "#" }] },
    { title: "Project", links: [{ label: "Benchmark", href: "#" }, { label: "Security model", href: "#" }] },
  ],
  copyright: "© 2026 Lemma",
  network: "Runs on Arbitrum Sepolia testnet",
} as const;

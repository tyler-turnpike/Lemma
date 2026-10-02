// Every user-facing string on the landing page and dashboard lives here.
// First-draft pitch copy; claims must stay within docs/demo-script.md "Claims to avoid".

const REPO = "https://github.com/tyler-turnpike/Lemma";

/** Static outbound destinations (all on github.com; see lib/links.ts for the allowlist). */
export const links = {
  repo: REPO,
  docs: `${REPO}#readme`,
  bridge: `${REPO}/blob/main/apps/bridge/README.md`,
  securityModel: `${REPO}/blob/main/docs/security-model.md`,
  benchmarkProtocol: `${REPO}/blob/main/docs/benchmark-protocol.md`,
  economics: `${REPO}/blob/main/docs/economics.md`,
} as const;

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
    { label: "Docs", href: links.docs },
    { label: "Catalog", href: "/catalog" },
    { label: "Status", href: "/status" },
    { label: "GitHub", href: links.repo },
  ] satisfies readonly NavLink[],
  cta: { label: "Get started", href: links.bridge } satisfies NavLink,
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
    { key: "privacy", title: "Your source stays local", body: "The bridge sends an allowlisted profile: languages, versions and a lockfile digest. Never your code.", href: links.securityModel },
    { key: "spend", title: "Caps the model can't move", body: "Per-resolution and daily limits are checked in code before anything is signed. No prompt can raise them.", href: links.bridge },
    { key: "warranty", title: "Bonded warranty", body: "Each paid resolution reserves provider bond. An evaluator-confirmed failure within 72 hours is refunded from it.", href: links.economics },
  ],
  learnMore: "Learn more",
} as const;

export const closing = {
  headline: ["Stop rediscovering,", "start reusing"],
  cta: { label: "Install the bridge", href: links.bridge } satisfies NavLink,
} as const;

export const footer = {
  columns: [
    { title: "Product", links: [{ label: "Catalog", href: "/catalog" }, { label: "Status", href: "/status" }] },
    { title: "Developers", links: [{ label: "Docs", href: links.docs }, { label: "GitHub", href: links.repo }] },
    { title: "Project", links: [{ label: "Benchmark", href: "/benchmark" }, { label: "Security model", href: links.securityModel }] },
  ],
  copyright: "© 2026 Lemma",
  network: "Runs on Arbitrum Sepolia testnet",
} as const;

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const dashboard = {
  tabs: [
    { label: "Catalog", href: "/catalog" },
    { label: "Resolutions", href: "/resolutions" },
    { label: "Benchmark", href: "/benchmark" },
    { label: "Status", href: "/status" },
  ] satisfies readonly NavLink[],
  testnetTag: "Arbitrum Sepolia · testnet USDC",
  states: {
    loading: "Loading",
    offline: {
      title: "API offline",
      body: "This page reads public records from the Lemma server at /api/v1, and the server is not reachable from here. You may be viewing a static preview, or the server is restarting.",
    },
    badResponse: {
      title: "Unreadable response",
      body: "The server answered with data this dashboard does not recognise, so nothing is shown rather than something wrong.",
    },
    rateLimited: { title: "Slow down", body: "Too many requests from this address. Wait a minute and retry." },
    unavailable: { title: "Server error", body: "The Lemma server could not answer this request." },
    retry: "Retry",
  },
  catalog: {
    title: "Catalog",
    label: "Catalog",
    headline: ["Capability Releases,", "curated and bonded"],
    lede: "Each release is a reviewed integration route pinned to an upstream commit, with a price, a provider bond and a claim window. Previews are free; you pay only when one fits your repository.",
    empty: { title: "No releases published", body: "The catalog is empty. Nothing can be purchased until a release is reviewed and published." },
    evidence: {
      provisional: "Provisional — not benchmarked",
      benchmarked: "Benchmarked",
    },
    fields: {
      price: "Price",
      bond: "Provider bond",
      claimWindow: "Claim window",
      expires: "Expires",
      taskKind: "Task kind",
      license: "License",
      provenance: "Provenance",
      payloadDigest: "Payload digest",
      files: "Files",
      profile: "Supported profile",
      exact: "Exact pins",
      limitations: "Limitations",
      expectedSaving: "Expected saving",
    },
  },
  resolution: {
    title: "Resolution",
    label: "Resolution",
    lookup: {
      headline: ["Inspect a resolution,", "payment to outcome"],
      lede: "Every paid Compatibility Resolution has a public record: the settlement transaction, the provider-signed warranty voucher and the buyer's adoption receipt. The patch itself is never shown here.",
      placeholder: "0x… 32-byte resolution id",
      submit: "Open",
      invalid: "A resolution id is 0x followed by 64 hex characters.",
    },
    lede: "Public record for one paid Compatibility Resolution. The delivered patch bundle is private to the buyer and is never shown.",
    invalid: { title: "Not a resolution id", body: "Resolution ids are 0x followed by 64 hex characters." },
    notFound: { title: "Resolution not found", body: "No resolution with this id exists on this server. Ids are unguessable, so check the link you were given." },
    steps: { payment: "Payment", voucher: "Warranty voucher", receipt: "Adoption receipt" },
    sections: { summary: "Summary", payment: "Payment", voucher: "Warranty voucher", warranty: "Warranty state", receipts: "Adoption receipts" },
    warrantyNote:
      "This API does not index onchain warranty activation yet. A signed voucher entitles the buyer to activate the warranty in the registry before the voucher expires; check the registry on Arbiscan for activation and claims.",
    noReceipts: "No adoption receipt submitted yet.",
  },
  benchmark: {
    title: "Benchmark",
    label: "Benchmark",
    headline: ["Cost-to-green,", "measured, not assumed"],
    lede: "A paired experiment on Arbitrum Sepolia: the same tasks, model and acceptance tests, with and without Lemma. Every run is kept, including failures.",
    notRun: {
      title: "Not run yet",
      body: "No benchmark results have been published. Until they are, Lemma makes no savings claim.",
      target: "The success target is at least 25% lower median all-in cost and total tokens, with identical acceptance results. It is a target, not a measured result.",
      protocol: [
        ["Tasks", "3 matched integration tasks + 1 no-match"],
        ["Arms", "Control and Lemma treatment"],
        ["Repetitions", "3 per arm"],
        ["Runs", "20 in total"],
        ["No-match rule", "Treatment must spend 0 USDC"],
      ],
      cta: "Read the protocol",
    },
    unrecognised: "An aggregate was published, but in a format this dashboard cannot read. Nothing is shown rather than a guess.",
    target: 0.25,
  },
  status: {
    title: "Status",
    label: "Status",
    headline: ["System status,", "public keys and contracts"],
    lede: "Everything a buyer relies on, in one place: which chain, which contracts, and which keys sign what.",
    trust: {
      title: "Trust assumptions",
      points: [
        "Testnet only: Arbitrum Sepolia and test USDC. No real money moves.",
        "The evaluator is a team-operated key, not decentralized arbitration.",
        "The server and the only provider are first-party infrastructure.",
      ],
      footnote: "Lemma demonstrates an economic mechanism, not trustless software correctness.",
    },
    sections: { chain: "Chain", contracts: "Contracts", roles: "Roles", services: "Services" },
    roles: {
      provider: "Provider · signs warranty vouchers",
      facilitator: "Facilitator · settles x402 payments",
      evaluator: "Evaluator · confirms warranty failures",
    },
    notConfigured: "Not configured",
  },
  notFound: { title: "Page not found", body: "There is nothing at this address.", cta: "Back to catalog" },
} as const;

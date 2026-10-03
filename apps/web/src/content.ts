// Every user-facing string on the landing page and dashboard lives here.
// Claims must stay within docs/demo-script.md "Claims to avoid" and match the published benchmark.

const REPO = "https://github.com/tyler-turnpike/Lemma";
/** The submission branch; `main` is still the bare scaffold. */
const BRANCH = "claude/happy-lovelace-tk3hme";
const TREE = `${REPO}/tree/${BRANCH}`;
const BLOB = `${REPO}/blob/${BRANCH}`;

/** Static outbound destinations (github.com and sepolia.arbiscan.io; see lib/links.ts for the allowlist). */
export const links = {
  repo: TREE,
  docs: `${BLOB}/docs/README.md`,
  bridge: `${BLOB}/apps/bridge/README.md`,
  securityModel: `${BLOB}/docs/security-model.md`,
  benchmarkProtocol: `${BLOB}/docs/benchmark-protocol.md`,
  economics: `${BLOB}/docs/economics.md`,
  registrySource: `${BLOB}/contracts/src/ResolutionWarrantyRegistry.sol`,
} as const;

/**
 * A real paid resolution on the production server (Arbitrum Sepolia): x402 settlement, warranty
 * activated on chain, acceptance tests passed (4/4, 3 files). `refundTx` is a real bond refund from
 * the same registry (an earlier, deliberately failed adoption). All resolve on Arbiscan.
 */
export const featured = {
  resolutionId: "0xcfc9ba00d23811b57fbdf25b3883981da5c72c6ee574887c26cc856ccf7b14cc",
  release: "x402-mcp-server@1.1.0",
  settlementTx: "0x279820c5c0b8abc0840c3f498a15e4fd86f4aef0a9d4f497ee49f1a2a5acd643",
  activationTx: "0x8743c7436ab46a6f1df2fb0a529d0191f9120d11983770189b2949e579ea2af5",
  refundTx: "0x4ce2d7730211aa1e37604ed5adccc9803a35ec487379eed61c87887fed9bc1ce",
  registry: "0x45Ae8799dF4C0878AD22CFe7040383F25f046d56",
  priceUsdc: "0.005",
  price: "0.005 USDC",
} as const;

export const featuredPath = `/resolutions/${featured.resolutionId}`;

export interface NavLink {
  readonly label: string;
  readonly href: string;
}

export const nav = {
  links: [
    { label: "Catalog", href: "/catalog" },
    { label: "Resolutions", href: "/resolutions" },
    { label: "Benchmark", href: "/benchmark" },
    { label: "Status", href: "/status" },
    { label: "GitHub", href: links.repo },
  ] satisfies readonly NavLink[],
  cta: { label: "Connect your agent", href: "/connect" } satisfies NavLink,
  menu: { open: "Open menu", close: "Close menu" },
} as const;

export const hero = {
  chip: "Live on Arbitrum Sepolia",
  headline: ["Verified integrations", "for coding agents"],
  lede: "Before your agent writes integration code, it asks Lemma. If a verified patch fits your repo, it pays a price quoted from measured savings (from half a cent) in USDC over x402 on Arbitrum, applies it, and gets a bonded warranty: if it fails, the contract refunds from the provider's bond.",
  primary: { label: "See a live purchase", href: featuredPath } satisfies NavLink,
  secondary: { label: "View on GitHub", href: links.repo } satisfies NavLink,
  tertiary: { label: "Connect your agent", href: "/connect" } satisfies NavLink,
} as const;

/**
 * Benchmark figures shown on the landing page. Live values come from /api/v1/benchmarks; these
 * are the published lemma-bench-v1 medians (matched tasks, n=9 per arm), used when the API is offline.
 */
export const benchmarkFallback = {
  controlTokens: 963_971,
  treatmentTokens: 242_443,
  controlPassed: 8,
  treatmentPassed: 9,
  runsPerArm: 9,
  controlDurationMs: 95_891,
  treatmentDurationMs: 42_418,
  controlCostUsd: 0.033625,
  treatmentCostUsd: 0.130562,
} as const;

export const liveProof = {
  label: "Live proof",
  registry: "Warranty registry",
  settlement: "Featured settlement",
  resolution: "Resolution record",
  measured: "Measured on testnet",
  honest: "All-in cost not yet lower at the current price",
  benchmarkLink: "See benchmark",
} as const;

export const howItWorks = {
  label: "How it works",
  headline: ["Four steps,", "each one live today"],
  lede: "The bridge runs next to your agent as an MCP server. It decides nothing with your money on its own: previews are free, payments are capped in code, and every purchase carries a bonded warranty.",
  live: "Live",
  steps: [
    { key: "preview", title: "Preview", body: "Free. The bridge sends an allowlisted repo profile and Lemma answers whether a verified release fits.", code: "lemma_preview" },
    { key: "pay", title: "Pay", body: "If it fits, the bridge pays over x402 in USDC on Arbitrum, inside per-purchase and daily caps.", code: "x402 · 0.005 USDC ≤ cap" },
    { key: "apply", title: "Apply", body: "The patch is applied atomically, then the release's pinned acceptance tests run locally.", code: "patch + pinned tests" },
    { key: "warranty", title: "Warranty", body: "A provider-signed voucher activates a bonded warranty. A confirmed failure is refunded from the bond.", code: "activateResolution(voucher)" },
  ],
} as const;

export const mock = {
  replay: "Replay",
  illustrative: "Illustrative",
} as const;

export const guarantees = {
  label: "Guarantees",
  headline: ["Recourse, not reputation,", "on every purchase"],
  lede: "Your code stays local, your agent cannot overspend, and a failed adoption costs the provider, not you.",
  cards: [
    { key: "privacy", title: "Your source stays local", body: "The bridge sends an allowlisted profile: languages, versions and a lockfile digest. Never your code.", href: links.securityModel },
    { key: "spend", title: "Caps the model can't move", body: "Per-resolution and daily limits are checked in code before anything is signed. No prompt can raise them.", href: "/connect" },
    { key: "warranty", title: "Bonded warranty", body: "Each paid resolution reserves its full price from the provider's bond. An evaluator-confirmed failure within 72 hours is refunded from it.", href: links.economics },
  ],
  learnMore: "Learn more",
} as const;

export const whyArbitrum = {
  label: "Why Arbitrum",
  headline: ["Does it need a chain?", "Here, yes"],
  lede: "Lemma sells small, frequent purchases with a promise attached. That only works if the payment is cheap, the promise is enforced by code rather than by us, and anyone can check the record.",
  cards: [
    {
      key: "payments",
      title: "Cent-level payments",
      body: "A half-cent USDC purchase settles over x402 on Arbitrum for a fraction of a cent of gas, so pricing each task by what it saves is viable.",
      linkLabel: "Featured settlement on Arbiscan",
    },
    {
      key: "refunds",
      title: "Refunds enforced by contract",
      body: "The provider's bond is locked in ResolutionWarrantyRegistry. A confirmed failure credits the buyer from it, with no trust in Lemma's server.",
      linkLabel: "A real bond refund on Arbiscan",
    },
    {
      key: "receipts",
      title: "Public receipts",
      body: "Every payment, warranty activation and refund is an Arbiscan transaction that a judge, buyer or provider can check.",
      linkLabel: "Registry contract on Arbiscan",
    },
  ],
} as const;

export const closing = {
  headline: ["Reuse what's proven,", "with recourse when it isn't"],
  cta: { label: "Connect your agent", href: "/connect" } satisfies NavLink,
  secondary: { label: "See a live purchase", href: featuredPath } satisfies NavLink,
} as const;

export const connect = {
  title: "Connect · Lemma",
  label: "Connect",
  headline: ["Connect Lemma", "to your coding agent"],
  lede: "One command installs the Lemma bridge as a local MCP server. It runs on your machine, holds its own testnet wallet, and never sends your source code.",
  steps: { install: "1 · Install", fund: "2 · Fund the wallet", ask: "3 · Ask your agent" },
  agentsLabel: "Choose your agent",
  copy: "Copy",
  copied: "Copied",
  agents: {
    cursor: { label: "Cursor", button: "Add to Cursor", note: "Opens Cursor and asks you to confirm the server." },
    vscode: { label: "VS Code", button: "Install in VS Code", note: "Opens VS Code's MCP install prompt (Copilot agent mode)." },
    claude: { label: "Claude Code", note: "Run in your project directory." },
    codex: { label: "Codex", note: "Run once, or add the TOML to ~/.codex/config.toml.", toml: "Or in config.toml" },
    goose: { label: "Goose", button: "Add to Goose", note: "Opens Goose and asks you to confirm the extension." },
    other: { label: "Other", note: "Windsurf, Zed, Cline and any client that reads an mcpServers JSON." },
  },
  fund: {
    body: "On first run the bridge creates a burner wallet in ~/.lemma/wallet.json (readable only by you). Ask your agent to call lemma_wallet: it prints the address and balances. Then send it test funds:",
    usdc: "Test USDC (Circle faucet, pick Arbitrum Sepolia)",
    eth: "Arbitrum Sepolia ETH for gas",
    caps: "Spending is capped in code at 0.25 USDC per resolution and 1.00 USDC per day. Testnet only: no real money moves.",
  },
  ask: {
    body: "Lemma is used before your agent writes integration code. Try, in a TypeScript MCP server repo:",
    prompt: "Add an x402 paywall to this MCP server. Check Lemma first.",
    after: "The agent previews for free, and pays only if a verified release fits your repo. You can watch the record on the resolutions page.",
  },
  never: {
    title: "What the bridge never does",
    points: [
      "Send your source: previews carry an allowlisted profile (languages, versions, lockfile digest).",
      "Spend past its caps: limits are checked in code before anything is signed.",
      "Use a key from an install link: no link on this page contains a secret.",
    ],
  },
  source: "Bridge source and README",
} as const;

export const footer = {
  columns: [
    { title: "Product", links: [{ label: "Catalog", href: "/catalog" }, { label: "Resolutions", href: "/resolutions" }, { label: "Status", href: "/status" }] },
    { title: "Developers", links: [{ label: "Connect", href: "/connect" }, { label: "Docs", href: links.docs }, { label: "GitHub", href: links.repo }] },
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
    earlier: {
      title: "Earlier versions (not sold)",
      body: "Same payload, earlier price. 1.0.0 was priced at 0.12 USDC before it was measured; the benchmark showed that price exceeded the saving, so 1.1.0 replaced it at a price derived from the measurement. Kept here so past purchases stay inspectable.",
    },
    empty: { title: "No releases published", body: "The catalog is empty. Nothing can be purchased until a release is reviewed and published." },
    evidence: {
      provisional: "Provisional — not benchmarked",
      benchmarked: "Benchmarked",
      published: "The price is set from this measured saving, capped at 30% of it.",
      publishedLink: "See benchmark",
      superseded: "Superseded · not sold",
      livePurchase: "Live purchase on testnet",
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
      another: "Look up another",
      demo: {
        label: "Try the live demo resolution",
        body: "A real purchase on the production server: 0.005 test USDC settled on Arbitrum Sepolia, warranty activated on chain, acceptance tests passed.",
        cta: "Open it",
      },
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
  notFound: { title: "Page not found", body: "There is nothing at this address.", cta: "Back to home" },
} as const;

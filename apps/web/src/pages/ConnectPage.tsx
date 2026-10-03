import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { DashboardShell, PageHeader, Panel } from "../components/dashboard/Shell.js";
import { connect, links } from "../content.js";
import {
  claudeCodeCommand,
  codexCommand,
  codexToml,
  cursorInstallUrl,
  genericJson,
  gooseInstallUrl,
  vscodeInstallUrl,
} from "../lib/connect.js";
import { Link } from "../router.js";

type AgentKey = keyof typeof connect.agents;
const AGENTS = Object.keys(connect.agents) as AgentKey[];

function CopyBlock({ text, label }: { readonly text: string; readonly label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => undefined,
    );
  };
  return (
    <div className="relative min-w-0 rounded-md border border-line bg-bg">
      <pre className="overflow-x-auto px-4 py-3.5 pr-20 font-mono text-[0.8125rem] leading-relaxed text-fg" aria-label={label}>
        <code>{text}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute top-2.5 right-2.5 rounded-full border border-line bg-card px-3 py-1 text-xs text-muted transition-colors hover:border-muted hover:text-fg"
      >
        <span aria-live="polite">{copied ? connect.copied : connect.copy}</span>
      </button>
    </div>
  );
}

/** Deep-link button into a desktop app. Plain anchor: custom schemes must not open a new tab. */
function InstallButton({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  const external = href.startsWith("https:");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="inline-flex h-10 items-center gap-2 rounded-full bg-mint pr-4 pl-5 text-[0.9375rem] font-medium whitespace-nowrap text-ink transition-colors hover:bg-mint-strong"
    >
      {children}
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3.5">
        <path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

function AgentInstructions({ agent }: { readonly agent: AgentKey }) {
  const note = <p className="text-sm text-muted">{connect.agents[agent].note}</p>;
  switch (agent) {
    case "cursor":
      return (
        <div className="space-y-4">
          <InstallButton href={cursorInstallUrl}>{connect.agents.cursor.button}</InstallButton>
          {note}
        </div>
      );
    case "vscode":
      return (
        <div className="space-y-4">
          <InstallButton href={vscodeInstallUrl}>{connect.agents.vscode.button}</InstallButton>
          {note}
        </div>
      );
    case "claude":
      return (
        <div className="space-y-4">
          <CopyBlock text={claudeCodeCommand} label="Claude Code command" />
          {note}
        </div>
      );
    case "codex":
      return (
        <div className="space-y-4">
          <CopyBlock text={codexCommand} label="Codex command" />
          {note}
          <p className="pt-2 text-xs text-faint">{connect.agents.codex.toml}</p>
          <CopyBlock text={codexToml} label="Codex config.toml" />
        </div>
      );
    case "goose":
      return (
        <div className="space-y-4">
          <InstallButton href={gooseInstallUrl}>{connect.agents.goose.button}</InstallButton>
          {note}
        </div>
      );
    case "other":
      return (
        <div className="space-y-4">
          <CopyBlock text={genericJson} label="MCP server JSON" />
          {note}
        </div>
      );
  }
}

function AgentTabs() {
  const [active, setActive] = useState<AgentKey>("cursor");
  const base = useId();
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = AGENTS[(AGENTS.indexOf(active) + step + AGENTS.length) % AGENTS.length]!;
    setActive(next);
    document.getElementById(`${base}-tab-${next}`)?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label={connect.agentsLabel} className="flex flex-wrap gap-2 border-b border-line px-5 py-4 md:px-6">
        {AGENTS.map((key) => {
          const selected = key === active;
          return (
            <button
              key={key}
              id={`${base}-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(key)}
              onKeyDown={onKey}
              className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                selected ? "bg-fg text-bg" : "border border-line text-muted hover:border-muted hover:text-fg"
              }`}
            >
              {connect.agents[key].label}
            </button>
          );
        })}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${active}`} className="px-5 py-6 md:px-6">
        <AgentInstructions agent={active} />
      </div>
    </div>
  );
}

const outbound = "text-fg underline decoration-line underline-offset-4 transition-colors hover:text-mint hover:decoration-mint";

export function ConnectPage() {
  return (
    <DashboardShell active={null}>
      <PageHeader label={connect.label} headline={connect.headline} lede={connect.lede} />
      <div className="mt-16 grid gap-6 md:mt-24 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          <Panel title={connect.steps.install}>
            <AgentTabs />
          </Panel>
          <Panel title={connect.steps.fund}>
            <div className="space-y-4 px-5 py-6 text-sm leading-relaxed text-muted md:px-6">
              <p>{connect.fund.body}</p>
              <ul className="space-y-2">
                <li>
                  <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className={outbound}>
                    {connect.fund.usdc}
                  </a>
                </li>
                <li>
                  <a href="https://www.alchemy.com/faucets/arbitrum-sepolia" target="_blank" rel="noopener noreferrer" className={outbound}>
                    {connect.fund.eth}
                  </a>
                </li>
              </ul>
              <p className="text-faint">{connect.fund.caps}</p>
            </div>
          </Panel>
          <Panel title={connect.steps.ask}>
            <div className="space-y-4 px-5 py-6 text-sm leading-relaxed text-muted md:px-6">
              <p>{connect.ask.body}</p>
              <CopyBlock text={connect.ask.prompt} label="Example prompt" />
              <p>
                {connect.ask.after}{" "}
                <Link href="/resolutions" className={outbound}>
                  /resolutions
                </Link>
              </p>
            </div>
          </Panel>
        </div>
        <aside className="min-w-0">
          <Panel title={connect.never.title}>
            <ul className="divide-y divide-line">
              {connect.never.points.map((point) => (
                <li key={point} className="px-5 py-4 text-sm leading-relaxed text-muted md:px-6">
                  {point}
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-5 py-4 text-sm md:px-6">
              <Link href={links.bridge} className={outbound}>
                {connect.source}
              </Link>
            </div>
          </Panel>
        </aside>
      </div>
    </DashboardShell>
  );
}

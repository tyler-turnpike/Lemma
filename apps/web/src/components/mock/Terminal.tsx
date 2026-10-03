import { DecisionCard } from "./DecisionCard.js";
import { type MockLine, mockStatus, mockSteps, mockTitle } from "./mockScript.js";

function Spinner() {
  return <span className="inline-block size-3 animate-spin rounded-full border border-faint border-t-fg align-[-1px]" />;
}

function Line({ line, active, typed }: { readonly line: MockLine; readonly active: boolean; readonly typed: boolean }) {
  switch (line.kind) {
    case "prompt":
      return (
        <p className="text-fg">
          <span className="text-muted">› </span>
          <span className={typed ? "" : "mock-type"} style={{ ["--chars" as string]: line.text.length }}>
            {line.text}
          </span>
        </p>
      );
    case "tool":
      return (
        <p className="mt-2.5 text-fg">
          {active ? <Spinner /> : <span className="text-muted">⏺</span>} {line.name}
          <span className="text-faint"> {line.args}</span>
        </p>
      );
    case "output":
      return (
        <p className="pl-4 text-muted">
          <span className="text-faint">{line.label} </span>
          {line.text}
        </p>
      );
    case "ok":
      return (
        <p className="pl-4">
          <span className="text-mint">✓</span> <span className="text-fg">{line.text}</span>
          {line.detail ? <span className="text-muted"> · {line.detail}</span> : null}
        </p>
      );
    case "diff":
      return (
        <ul className="pl-4 text-muted">
          {line.files.map((file) => (
            <li key={file.path} className="flex gap-3">
              <span className="min-w-0 flex-1 truncate">{file.path}</span>
              <span className="text-mint">+{file.add}</span>
              <span className="text-faint">−{file.del}</span>
            </li>
          ))}
        </ul>
      );
    case "card":
      // The payoff: the decision sits inline in the transcript, inside the terminal's own width.
      return (
        <div className="my-2 pl-4">
          <DecisionCard />
        </div>
      );
  }
}

/** The agent session. Sized to sit beside the hero copy at lg and up without being cropped. */
export function Terminal({ visible }: { readonly visible: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111a1c]/95 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
      <div className="relative flex h-9 items-center border-b border-white/5 px-4">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#2c3b3b]" />
          <span className="size-2.5 rounded-full bg-[#2c3b3b]" />
          <span className="size-2.5 rounded-full bg-[#2c3b3b]" />
        </div>
        <span className="absolute inset-x-0 text-center font-mono text-[0.6875rem] text-muted">{mockTitle}</span>
      </div>

      <div className="px-4 py-3 font-mono text-[0.6875rem] leading-5 md:px-5">
        <p className="text-faint">lemma-bridge connected · arbitrum-sepolia · caps 0.25 / 1.00 USDC</p>
        <div className="mt-3">
          {mockSteps.map((step, index) => (
            <div
              key={index}
              className={`transition-all duration-300 ${index < visible ? "translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0"}`}
            >
              <Line line={step.line} active={index === visible - 1 && step.line.kind === "tool"} typed={visible > 1} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-white/5 px-4 py-2 font-mono text-[0.625rem] text-faint md:px-5">
        <span className="flex gap-3">
          {mockStatus.left.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </span>
        <span className="hidden gap-3 sm:flex">
          {mockStatus.right.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </span>
      </div>
    </div>
  );
}

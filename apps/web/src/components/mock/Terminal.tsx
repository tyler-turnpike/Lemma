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
        <p className="mt-3 text-fg">
          {active ? <Spinner /> : <span className="text-muted">⏺</span>} {line.name}
          <span className="text-faint"> {line.args}</span>
        </p>
      );
    case "output":
      return (
        <p className="pl-5 text-muted">
          <span className="text-faint">{line.label} </span>
          {line.text}
        </p>
      );
    case "ok":
      return (
        <p className="pl-5">
          <span className="text-signal">✓</span> <span className="text-fg">{line.text}</span>
          {line.detail ? <span className="text-muted"> · {line.detail}</span> : null}
        </p>
      );
    case "diff":
      return (
        <ul className="pl-5 text-muted">
          {line.files.map((file) => (
            <li key={file.path} className="flex gap-3">
              <span className="min-w-0 flex-1 truncate md:max-w-60">{file.path}</span>
              <span className="text-signal">+{file.add}</span>
              <span className="text-faint">−{file.del}</span>
            </li>
          ))}
        </ul>
      );
    case "card":
      // Large screens show the card floating beside the terminal; mobile shows it inline.
      return (
        <div className="my-3 pl-5 lg:hidden">
          <DecisionCard />
        </div>
      );
  }
}

export function Terminal({ visible }: { readonly visible: number }) {
  const cardIndex = mockSteps.findIndex((step) => step.line.kind === "card");

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#121212]/95 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
        <div className="relative flex h-10 items-center border-b border-white/5 px-4">
          <div className="flex gap-2">
            <span className="size-3 rounded-full bg-[#3a3a3a]" />
            <span className="size-3 rounded-full bg-[#3a3a3a]" />
            <span className="size-3 rounded-full bg-[#3a3a3a]" />
          </div>
          <span className="absolute inset-x-0 text-center font-mono text-xs text-muted">{mockTitle}</span>
        </div>

        <div className="min-h-[27rem] px-5 py-5 font-mono text-[0.75rem] leading-6 md:px-6 md:text-[0.8125rem]">
          <p className="text-faint">lemma-bridge connected · arbitrum-sepolia · caps 0.25 / 1.00 USDC</p>
          <div className="mt-4">
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

        <div className="flex items-center justify-between gap-4 border-t border-white/5 px-5 py-2.5 font-mono text-[0.6875rem] text-faint">
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

      <div
        className={`absolute top-28 -right-40 hidden transition-all duration-500 lg:block ${
          visible > cardIndex ? "translate-y-0 opacity-100" : "invisible translate-y-3 opacity-0"
        }`}
      >
        <DecisionCard />
      </div>
    </div>
  );
}

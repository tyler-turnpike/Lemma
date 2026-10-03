import { mock } from "../../content.js";
import { Grain } from "../Grain.js";
import { mockSteps, transcript } from "./mockScript.js";
import { Terminal } from "./Terminal.js";
import { useTimeline } from "./useTimeline.js";

const delays = mockSteps.map((step) => step.delay);

/** The animated agent session, framed for the hero's right column. */
export function AgentDemo() {
  const { target, visible, done, replay } = useTimeline(delays);

  return (
    <div ref={target} className="relative">
      <div
        aria-hidden="true"
        className="absolute -inset-2 overflow-hidden rounded-[1.25rem] border border-line bg-[#131c1e] sm:-inset-4 md:-inset-6"
        style={{
          background:
            "radial-gradient(60% 50% at 15% 20%, #2f4644 0%, transparent 70%), radial-gradient(50% 60% at 85% 85%, #253634 0%, transparent 70%), repeating-linear-gradient(115deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 7px)",
        }}
      >
        <Grain opacity={0.5} />
      </div>

      <div className="relative">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[0.6875rem] text-muted backdrop-blur">
            {mock.illustrative}
          </span>
          <button
            type="button"
            onClick={replay}
            disabled={!done}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[0.6875rem] text-muted backdrop-blur transition hover:text-fg disabled:invisible"
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3">
              <path d="M13 8a5 5 0 1 1-1.46-3.54M13 3v2.5h-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {mock.replay}
          </button>
        </div>

        <div aria-hidden="true">
          <Terminal visible={visible} />
        </div>

        <ol className="sr-only">
          {transcript().map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

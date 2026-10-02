import { mock } from "../../content.js";
import { Grain } from "../Grain.js";
import { SectionHeader } from "../SectionHeader.js";
import { mockSteps, transcript } from "./mockScript.js";
import { Terminal } from "./Terminal.js";
import { useTimeline } from "./useTimeline.js";

const delays = mockSteps.map((step) => step.delay);

export function ProductMock() {
  const { target, visible, done, replay } = useTimeline(delays);

  return (
    <section aria-labelledby="mock-title" className="py-24 md:py-40">
      <div className="container-page">
        <SectionHeader id="mock-title" label={mock.label} headline={mock.headline} lede={mock.lede} />

        <div
          ref={target}
          className="relative mt-16 overflow-hidden rounded border border-line bg-[#141414] px-4 py-12 md:mt-24 md:px-16 md:py-20"
        >
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 50% at 15% 20%, #3a3a3a 0%, transparent 70%), radial-gradient(50% 60% at 85% 85%, #2e2e2e 0%, transparent 70%), repeating-linear-gradient(115deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 7px)",
            }}
          />
          <Grain opacity={0.5} />

          <div aria-hidden="true" className="relative mx-auto max-w-[52rem]">
            <Terminal visible={visible} />
          </div>

          <button
            type="button"
            onClick={replay}
            disabled={!done}
            className="absolute right-4 bottom-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-muted backdrop-blur transition hover:text-fg disabled:opacity-0"
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3.5">
              <path d="M13 8a5 5 0 1 1-1.46-3.54M13 3v2.5h-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {mock.replay}
          </button>

          <ol className="sr-only">
            {transcript().map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

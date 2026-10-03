import { howItWorks } from "../content.js";
import { Badge } from "./dashboard/Badge.js";
import { SectionHeader } from "./SectionHeader.js";

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="py-24 md:py-40">
      <div className="container-page">
        <SectionHeader id="how-title" label={howItWorks.label} headline={howItWorks.headline} lede={howItWorks.lede} />
        <ol className="mt-16 grid gap-px overflow-hidden rounded-md border border-line bg-line md:mt-24 md:grid-cols-2 lg:grid-cols-4">
          {howItWorks.steps.map((step, index) => (
            <li key={step.key} className="flex min-w-0 flex-col bg-card px-5 py-6 md:px-6 md:py-8">
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-sm text-faint">0{index + 1}</span>
                <Badge tone="success">{howItWorks.live}</Badge>
              </div>
              <h3 className="mt-6 text-xl text-fg">{step.title}</h3>
              <p className="mt-2 flex-1 leading-relaxed text-muted">{step.body}</p>
              <code className="mt-6 block truncate rounded-sm border border-line bg-bg px-3 py-2 font-mono text-[0.8125rem] text-fg">{step.code}</code>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

import { closing } from "../content.js";
import { PillLink } from "./PillLink.js";

export function ClosingCta() {
  return (
    <section className="container-page py-32 text-center md:py-48">
      <h2 className="text-[2rem] leading-[1.15] tracking-[-0.025em] text-balance md:text-display">
        <span className="block text-fg">{closing.headline[0]}</span>
        <span className="block text-muted">{closing.headline[1]}</span>
      </h2>
      <div className="mt-10">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <PillLink href={closing.cta.href}>{closing.cta.label}</PillLink>
          <PillLink href={closing.secondary.href} variant="secondary">
            {closing.secondary.label}
          </PillLink>
        </div>
      </div>
    </section>
  );
}

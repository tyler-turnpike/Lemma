import { hero } from "../content.js";
import { Link } from "../router.js";
import { AgentDemo } from "./mock/AgentDemo.js";
import { PillLink } from "./PillLink.js";

export function Hero() {
  const [lineOne, lineTwo] = hero.headline;

  return (
    <section className="relative overflow-hidden pt-[136px] pb-16 md:pt-[168px] md:pb-24 lg:pt-[128px] lg:pb-20">
      <div className="container-page grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-12 xl:gap-16">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-sm text-muted">
            <span aria-hidden="true" className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-mint" />
            </span>
            {hero.chip}
          </p>
          <h1 className="mt-8 text-[2.5rem] leading-[1.1] tracking-[-0.03em] md:text-[4rem] lg:text-[3.5rem] xl:text-[4rem]">
            <span className="block text-fg">{lineOne}</span>
            <span className="block text-muted">{lineTwo}</span>
          </h1>
          <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted md:text-lede lg:text-lg xl:text-[1.25rem]">{hero.lede}</p>
          <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-3">
            <PillLink href={hero.primary.href}>{hero.primary.label}</PillLink>
            <PillLink href={hero.secondary.href} variant="secondary">
              {hero.secondary.label}
            </PillLink>
            <Link href={hero.tertiary.href} className="inline-flex h-10 items-center gap-1.5 px-1 text-[0.9375rem] text-fg transition-colors hover:text-mint">
              {hero.tertiary.label} <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        <AgentDemo />
      </div>
    </section>
  );
}

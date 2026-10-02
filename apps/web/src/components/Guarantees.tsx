import type { ReactNode } from "react";

import { guarantees } from "../content.js";
import { Grain } from "./Grain.js";
import { SectionHeader } from "./SectionHeader.js";

type CardKey = (typeof guarantees.cards)[number]["key"];

// Grayscale textures standing in for Polar's blurred wave photography.
const textures: Record<CardKey, string> = {
  privacy:
    "radial-gradient(70% 60% at 20% 15%, #4a4a4a 0%, transparent 70%), radial-gradient(60% 50% at 90% 90%, #1c1c1c 0%, transparent 70%), repeating-linear-gradient(125deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 6px), #2a2a2a",
  spend:
    "radial-gradient(60% 70% at 80% 10%, #505050 0%, transparent 70%), radial-gradient(70% 60% at 10% 95%, #1a1a1a 0%, transparent 70%), repeating-linear-gradient(150deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 6px), #2b2b2b",
  warranty:
    "radial-gradient(60% 60% at 50% 0%, #4c4c4c 0%, transparent 70%), radial-gradient(60% 60% at 15% 85%, #1d1d1d 0%, transparent 70%), repeating-linear-gradient(100deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 6px), #292929",
};

function Chip({ children }: { readonly children: ReactNode }) {
  return <div className="w-full max-w-[17rem] rounded-sm bg-[#141414]/95 p-5 text-sm shadow-2xl">{children}</div>;
}

const chips: Record<CardKey, ReactNode> = {
  privacy: (
    <Chip>
      <p className="text-xs text-muted">Repository profile</p>
      <ul className="mt-3 space-y-1.5 font-mono text-xs">
        <li className="flex justify-between"><span className="text-muted">language</span><span>typescript</span></li>
        <li className="flex justify-between"><span className="text-muted">lockfile</span><span>sha256 · 9a1f…</span></li>
        <li className="flex justify-between"><span className="text-muted">source</span><span>never sent</span></li>
      </ul>
    </Chip>
  ),
  spend: (
    <Chip>
      <div className="flex justify-between">
        <span className="font-mono text-fg">0.12 USDC</span>
        <span className="text-muted">cap 0.25</span>
      </div>
      <div className="mt-4 h-1 rounded-full bg-[#2a2a2a]">
        <div className="h-full w-[48%] rounded-full bg-fg" />
      </div>
      <p className="mt-3 text-xs text-muted">Today 0.12 / 1.00 USDC</p>
    </Chip>
  ),
  warranty: (
    <Chip>
      <div className="flex justify-between">
        <span className="text-fg">Refund credit</span>
        <span className="font-mono text-fg">0.12 USDC</span>
      </div>
      <p className="mt-1 text-muted">From provider bond · 72h window</p>
      <p className="mt-4 flex items-center gap-2 text-xs text-muted">
        <span className="inline-block size-3 animate-spin rounded-full border border-faint border-t-fg motion-reduce:animate-none" />
        Awaiting evaluator…
      </p>
    </Chip>
  ),
};

export function Guarantees() {
  return (
    <section aria-labelledby="guarantees-title" className="py-24 md:py-40">
      <div className="container-page">
        <SectionHeader id="guarantees-title" label={guarantees.label} headline={guarantees.headline} lede={guarantees.lede} />

        <ul className="mt-16 grid gap-12 md:mt-24 md:grid-cols-3 md:gap-8">
          {guarantees.cards.map((card) => (
            <li key={card.key}>
              <div
                aria-hidden="true"
                className="relative flex aspect-[4/3] items-center justify-center overflow-hidden px-8"
                style={{ background: textures[card.key] }}
              >
                <Grain opacity={0.45} />
                <div className="relative w-full flex justify-center">{chips[card.key]}</div>
              </div>
              <h3 className="mt-8 text-xl text-fg">{card.title}</h3>
              <p className="mt-2 leading-relaxed text-muted">{card.body}</p>
              <a href={card.href} className="mt-3 inline-flex items-center gap-1.5 text-fg hover:opacity-80">
                {guarantees.learnMore} <span aria-hidden="true">→</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

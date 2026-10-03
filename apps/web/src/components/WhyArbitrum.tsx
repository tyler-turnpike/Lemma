import { featured, whyArbitrum } from "../content.js";
import { arbiscanAddress, arbiscanTx } from "../lib/links.js";
import { ExternalLink } from "./dashboard/Fields.js";
import { SectionHeader } from "./SectionHeader.js";

type CardKey = (typeof whyArbitrum.cards)[number]["key"];

const hrefs: Record<CardKey, string | null> = {
  payments: arbiscanTx(featured.settlementTx),
  refunds: arbiscanTx(featured.refundTx),
  receipts: arbiscanAddress(featured.registry),
};

export function WhyArbitrum() {
  return (
    <section aria-labelledby="arbitrum-title" className="py-24 md:py-40">
      <div className="container-page">
        <SectionHeader id="arbitrum-title" label={whyArbitrum.label} headline={whyArbitrum.headline} lede={whyArbitrum.lede} />
        <ul className="mt-16 grid gap-6 md:mt-24 md:grid-cols-3">
          {whyArbitrum.cards.map((card) => (
            <li key={card.key} className="flex min-w-0 flex-col rounded-md border border-line bg-card px-5 py-6 md:px-6 md:py-8">
              <h3 className="text-xl text-fg">{card.title}</h3>
              <p className="mt-3 flex-1 leading-relaxed text-muted">{card.body}</p>
              <p className="mt-6 text-sm">
                <ExternalLink href={hrefs[card.key]}>{card.linkLabel}</ExternalLink>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

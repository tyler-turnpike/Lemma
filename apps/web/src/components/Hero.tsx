import { hero } from "../content.js";
import { Ruler } from "./Ruler.js";

export function Hero() {
  const [lineOne, lineTwo] = hero.headline;

  return (
    <section className="relative overflow-hidden pt-[136px] pb-24 md:pb-32">
      <div className="container-page">
        <h1 className="text-[1.75rem] leading-tight tracking-[-0.02em] md:text-eyebrow">
          <span className="block text-fg">{hero.eyebrow}</span>
          <span className="block text-muted">{hero.positioning}</span>
        </h1>
      </div>

      <div className="container-page mt-24 md:mt-32">
        <Ruler spec={hero.rulers.top} labels="below" />
      </div>

      <p className="container-page my-16 text-center text-[2.25rem] leading-[1.15] tracking-[-0.025em] md:my-20 md:text-display">
        <span className="block text-fg">{lineOne}</span>
        <span className="block text-muted">{lineTwo}</span>
      </p>

      <div className="container-page">
        <Ruler spec={hero.rulers.bottom} labels="above" />
      </div>
    </section>
  );
}

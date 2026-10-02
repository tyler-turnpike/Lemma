import { useId } from "react";

// Static film-grain overlay drawn with an SVG turbulence filter (no image assets).
export function Grain({ opacity = 0.35 }: { readonly opacity?: number }) {
  const id = useId();
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full mix-blend-overlay" style={{ opacity }}>
      <filter id={id}>
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
}

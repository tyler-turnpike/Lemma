import { useId } from "react";

/**
 * The Lemma mark: the L's stem, the mint band that rises from its foot, and the arrow that drops
 * the proven piece into place. Geometry from docs/brand; colors are the dark-background variant,
 * inlined so the mark needs no stylesheet.
 */
const VIEW_BOX = "96 36 222 242";
const STEM =
  "M106.41 71.38L153.82 44.01A12.12 12.12 0 0 1 172 54.51L172 227.87A11.38 11.38 0 0 1 160.62 239.25L113.26 239.25A11.38 11.38 0 0 1 101.88 227.87L101.88 79.23A9.06 9.06 0 0 1 106.41 71.38Z";
const BAND =
  "M117.66 206.51L193.48 151.42A16.62 16.62 0 0 1 203.25 148.25L251.12 148.25A36.69 36.69 0 0 1 287.81 184.94L287.81 221.5L306.1 221.5A2.75 2.75 0 0 1 308.07 226.17L266.88 268.41A6.25 6.25 0 0 1 257.93 268.41L216.74 226.17A2.75 2.75 0 0 1 218.71 221.5L237 221.5L237 192.73L152.34 254.24A28 28 0 0 1 113.23 248.05L111.46 245.62A28 28 0 0 1 117.66 206.51Z";
/** The right leg and arrowhead, where the band darkens into the tip. */
const LEG = "M236 120H330V290H210.18V221H236Z";
/** Width over height of the view box. */
const RATIO = 222 / 242;

const STEM_FILL = "#EDF3F1";
const TIP = "#1FA27D";
const INK = "#0E1518";

/** A DOM id that is safe inside `url(#…)`: React's ids carry punctuation. */
function useMarkId(): string {
  return `lm${useId().replace(/[^A-Za-z0-9]/g, "")}`;
}

const px = (n: number) => Math.round(n * 100) / 100;

/** The full-color mark. `size` is its height in pixels. */
export function LogoMark({ size = 28, className }: { readonly size?: number; readonly className?: string }) {
  const id = useMarkId();
  const band = `${id}b`;
  const tip = `${id}t`;
  const shade = `${id}s`;
  const clip = `${id}c`;
  return (
    <svg className={className} width={px(size * RATIO)} height={size} viewBox={VIEW_BOX} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={band} gradientUnits="userSpaceOnUse" x1="191.2" y1="186.5" x2="216.8" y2="156.9">
          <stop stopColor="#5FE6BA" offset="0" />
          <stop stopColor="#44CDA0" offset="0.487" />
          <stop stopColor="#17906B" offset="1" />
        </linearGradient>
        <linearGradient id={tip} gradientUnits="userSpaceOnUse" x1="0" y1="162" x2="0" y2="228">
          <stop stopColor={TIP} stopOpacity="0" offset="0" />
          <stop stopColor={TIP} stopOpacity="1" offset="1" />
        </linearGradient>
        <linearGradient id={shade} gradientUnits="userSpaceOnUse" x1="122.51" y1="202.98" x2="145.73" y2="234.94">
          <stop stopColor={INK} stopOpacity="0.61" offset="0" />
          <stop stopColor={INK} stopOpacity="0" offset="1" />
        </linearGradient>
        <clipPath id={clip}>
          <path d={BAND} />
        </clipPath>
      </defs>
      <path fill={STEM_FILL} d={STEM} />
      <path fill={`url(#${band})`} d={BAND} />
      <g clipPath={`url(#${clip})`}>
        <path fill={`url(#${shade})`} d={STEM} />
        <path fill={`url(#${tip})`} d={LEG} />
      </g>
    </svg>
  );
}

/** The one-color mark in `currentColor`, for small or monochrome placements. */
export function MarkMono({ size = 24, className }: { readonly size?: number; readonly className?: string }) {
  const id = useMarkId();
  return (
    <svg className={className} width={px(size * RATIO)} height={size} viewBox={VIEW_BOX} aria-hidden="true" focusable="false">
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="90" y="30" width="240" height="260">
          <rect x="90" y="30" width="240" height="260" fill="#fff" />
          <path d={BAND} fill="#000" stroke="#000" strokeWidth="14" strokeLinejoin="round" />
        </mask>
      </defs>
      <path fill="currentColor" mask={`url(#${id})`} d={STEM} />
      <path fill="currentColor" d={BAND} />
    </svg>
  );
}

/** The lockup: the mark beside the Geist wordmark, as live text. */
export function Logo({ size = 28 }: { readonly size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-fg">
      <LogoMark size={size} className="shrink-0" />
      <span className="text-[1.0625rem] font-medium tracking-[-0.01em]">Lemma</span>
    </span>
  );
}

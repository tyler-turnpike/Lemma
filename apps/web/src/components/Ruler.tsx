import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { RulerSpec } from "../content.js";

const SPACING = 18;
const FALLBACK_WIDTH = 1600;

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function formatLabel(unit: RulerSpec["unit"], value: number): string {
  return unit === "tokens" ? `${(value / 1_000_000).toFixed(1)}M` : `$${value.toFixed(2)}`;
}

function formatPill(unit: RulerSpec["unit"], value: number): string {
  return unit === "tokens" ? `${(value / 1_000_000).toFixed(2)}M` : `$${value.toFixed(2)}`;
}

// Hides moving ticks near the centre (where the fixed marker sits) and fades both edges.
function centreMask(gap: number): string {
  return `linear-gradient(to right, transparent, #000 10%, #000 calc(50% - ${gap}px), transparent calc(50% - ${gap}px), transparent calc(50% + ${gap}px), #000 calc(50% + ${gap}px), #000 90%, transparent)`;
}

const EDGE_FADE = "linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)";

interface RulerProps {
  readonly spec: RulerSpec;
  readonly labels: "above" | "below";
}

export function Ruler({ spec, labels }: RulerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tickStripRef = useRef<HTMLDivElement>(null);
  const labelStripRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const pillRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  const period = spec.labelEvery * SPACING;
  const tickCount = Math.ceil((width + period) / SPACING) + 1;
  const labelCount = Math.ceil(tickCount / spec.labelEvery);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Animation state lives outside React so each frame touches the DOM directly.
  const motion = useRef({ offset: 0, shift: 0 });

  useIsomorphicLayoutEffect(() => {
    const paint = () => {
      const { offset, shift } = motion.current;
      const transform = `translate3d(${-offset}px, 0, 0)`;
      if (tickStripRef.current) tickStripRef.current.style.transform = transform;
      if (labelStripRef.current) labelStripRef.current.style.transform = transform;
      labelRefs.current.forEach((node, index) => {
        if (!node) return;
        const tickIndex = (shift + index) * spec.labelEvery;
        node.textContent = formatLabel(spec.unit, spec.start + tickIndex * spec.perTick);
        // Fade labels out as they slide under the value pill.
        const distance = Math.abs(index * period - offset - width / 2);
        node.style.opacity = String(Math.min(1, Math.max(0, (distance - 46) / 24)));
      });
      if (pillRef.current) {
        const ticksToCentre = shift * spec.labelEvery + (offset + width / 2) / SPACING;
        pillRef.current.textContent = formatPill(spec.unit, spec.start + ticksToCentre * spec.perTick);
      }
    };

    paint();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      motion.current.offset += spec.speed * dt;
      while (motion.current.offset >= period) {
        motion.current.offset -= period;
        motion.current.shift += 1;
      }
      paint();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [spec, period, width, labelCount]);

  const tickRow = (
    <div className="relative h-7">
      <div className="absolute inset-0 overflow-hidden" style={{ maskImage: centreMask(26) }}>
        <div ref={tickStripRef} className="absolute inset-y-0 left-0 will-change-transform">
          {Array.from({ length: tickCount }, (_, i) => (
            <span
              key={i}
              className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-faint"
              style={{ left: i * SPACING }}
            />
          ))}
        </div>
      </div>
      {/* Fixed marker bracket */}
      <span className="absolute top-1/2 left-1/2 h-5 w-px -translate-y-1/2 bg-[#4a4a4a]" style={{ marginLeft: -SPACING }} />
      <span className="absolute inset-y-0 left-1/2 w-px bg-fg" />
      <span className="absolute top-1/2 left-1/2 h-5 w-px -translate-y-1/2 bg-[#4a4a4a]" style={{ marginLeft: SPACING }} />
    </div>
  );

  const caret = (
    <div className="flex h-3 justify-center">
      <svg viewBox="0 0 8 6" className={`mt-0.5 h-1.5 w-2 fill-fg ${labels === "above" ? "rotate-180" : ""}`}>
        <path d="M4 0 8 6H0Z" />
      </svg>
    </div>
  );

  const labelRow = (
    <div className="relative h-6">
      <div className="absolute inset-0 overflow-hidden" style={{ maskImage: EDGE_FADE }}>
        <div ref={labelStripRef} className="absolute inset-y-0 left-0 will-change-transform">
          {Array.from({ length: labelCount }, (_, i) => (
            <span
              key={i}
              ref={(node) => {
                labelRefs.current[i] = node;
              }}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs whitespace-nowrap text-faint tabular-nums"
              style={{ left: i * period }}
            >
              {formatLabel(spec.unit, spec.start + i * period / SPACING * spec.perTick)}
            </span>
          ))}
        </div>
      </div>
      <span
        ref={pillRef}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg px-2.5 py-0.5 text-xs font-medium text-bg tabular-nums"
      >
        {formatPill(spec.unit, spec.start + (width / 2 / SPACING) * spec.perTick)}
      </span>
    </div>
  );

  return (
    <div ref={rootRef} aria-hidden="true" className="relative w-full select-none">
      {labels === "below" ? (
        <>
          {tickRow}
          {caret}
          {labelRow}
        </>
      ) : (
        <>
          {labelRow}
          {caret}
          {tickRow}
        </>
      )}
    </div>
  );
}

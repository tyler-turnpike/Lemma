import { useCallback, useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Reveals `delays.length` steps one after another once `target` is 40% visible.
 * Server render and reduced motion show the final frame.
 */
export function useTimeline(delays: readonly number[]) {
  const total = delays.length;
  const target = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() =>
    typeof window === "undefined" || prefersReducedMotion() ? total : 0,
  );
  const [run, setRun] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion() || started.current || !target.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          started.current = true;
          observer.disconnect();
          setRun((n) => n + 1);
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(target.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (run === 0) return;
    setVisible(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = 0;
    delays.forEach((delay, index) => {
      at += delay;
      timers.push(setTimeout(() => setVisible(index + 1), at));
    });
    return () => timers.forEach(clearTimeout);
  }, [run, delays]);

  const replay = useCallback(() => setRun((n) => n + 1), []);

  return { target, visible, done: visible >= total, replay };
}

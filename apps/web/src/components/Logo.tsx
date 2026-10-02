// Placeholder mark: a circle split by a chord. Swap for the real mark later.
export function LogoMark({ className = "size-7" }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true" className={className}>
      <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18.2 2.76A12 12 0 0 1 18.2 25.24Z" fill="currentColor" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5 text-fg">
      <LogoMark />
      <span className="text-[1.0625rem] font-medium tracking-[-0.01em]">Lemma</span>
    </span>
  );
}

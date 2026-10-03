import type { ReactNode } from "react";

import { Link } from "../router.js";

type Variant = "primary" | "secondary";

const variants: Record<Variant, string> = {
  // Mint fill with ink text (about 12:1). Reserved for the main call to action.
  primary: "bg-mint text-ink hover:bg-mint-strong",
  secondary: "border border-line text-fg hover:border-muted",
};

export function PillLink({ href, children, variant = "primary" }: { readonly href: string; readonly children: ReactNode; readonly variant?: Variant }) {
  return (
    <Link
      href={href}
      className={`inline-flex h-10 items-center gap-2 rounded-full pr-4 pl-5 text-[0.9375rem] font-medium whitespace-nowrap transition-colors ${variants[variant]}`}
    >
      {children}
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3.5">
        <path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

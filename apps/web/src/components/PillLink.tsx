import type { ReactNode } from "react";

import { Link } from "../router.js";

export function PillLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center gap-2 rounded-full bg-fg pr-4 pl-5 text-[0.9375rem] font-medium text-bg transition-opacity hover:opacity-85"
    >
      {children}
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3.5">
        <path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

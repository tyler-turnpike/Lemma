import { useEffect, useId, useState } from "react";

import { nav } from "../content.js";
import { Link } from "../router.js";
import { Logo } from "./Logo.js";
import { PillLink } from "./PillLink.js";

export function Nav({ active = null }: { readonly active?: string | null }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onResize = () => {
      if (window.matchMedia("(min-width: 48rem)").matches) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Close the menu whenever the route changes.
  useEffect(() => setOpen(false), [active]);

  const close = () => setOpen(false);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${
        open ? "border-line bg-bg" : scrolled ? "border-line bg-bg/80 backdrop-blur-md" : "border-transparent"
      }`}
    >
      <nav className="container-page flex h-[72px] items-center gap-10" aria-label="Main">
        <Link href="/" aria-label="Lemma home" className="flex items-center rounded-md" onClick={close}>
          <Logo />
        </Link>
        <ul className="hidden items-center gap-6 md:flex">
          {nav.links.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                aria-current={link.href === active ? "page" : undefined}
                className={`text-[0.9375rem] transition-colors hover:text-mint ${link.href === active ? "text-fg" : "text-muted"}`}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <PillLink href={nav.cta.href}>{nav.cta.label}</PillLink>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? nav.menu.close : nav.menu.open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-10 items-center justify-center rounded-full border border-line text-fg transition-colors hover:border-muted md:hidden"
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-4">
              {open ? (
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M2.5 5h11M2.5 11h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </nav>
      <div id={menuId} hidden={!open} className="border-t border-line md:hidden" data-mobile-menu="">
        <ul className="container-page flex flex-col py-3">
          {nav.links.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                onClick={close}
                aria-current={link.href === active ? "page" : undefined}
                className={`flex h-12 items-center text-lg transition-colors hover:text-mint ${link.href === active ? "text-fg" : "text-muted"}`}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

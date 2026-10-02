import { useEffect, useState } from "react";

import { nav } from "../content.js";
import { Logo } from "./Logo.js";
import { PillLink } from "./PillLink.js";
import { Link } from "../router.js";

export function Nav({ active = null }: { readonly active?: string | null }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${
        scrolled ? "border-line bg-bg/80 backdrop-blur-md" : "border-transparent"
      }`}
    >
      <nav className="container-page flex h-[72px] items-center gap-10" aria-label="Main">
        <Link href="/" aria-label="Lemma home" className="rounded-md">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-6 md:flex">
          {nav.links.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                aria-current={link.href === active ? "page" : undefined}
                className={`text-[0.9375rem] transition-colors hover:text-fg ${link.href === active ? "text-fg" : "text-muted"}`}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto">
          <PillLink href={nav.cta.href}>{nav.cta.label}</PillLink>
        </div>
      </nav>
    </header>
  );
}

import { footer } from "../content.js";
import { Logo } from "./Logo.js";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="container-page grid gap-12 py-16 md:grid-cols-[1fr_auto] md:gap-24">
        <Logo />
        <nav aria-label="Footer" className="grid grid-cols-2 gap-10 sm:grid-cols-3 md:gap-20">
          {footer.columns.map((column) => (
            <div key={column.title}>
              <p className="text-sm text-fg">{column.title}</p>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-sm text-muted transition-colors hover:text-fg">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="container-page flex flex-col gap-2 border-t border-line py-6 text-xs text-faint sm:flex-row sm:justify-between">
        <span>{footer.copyright}</span>
        <span>{footer.network}</span>
      </div>
    </footer>
  );
}

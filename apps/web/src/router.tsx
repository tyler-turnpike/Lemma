// Minimal pathname router. The Lemma server answers unknown paths with index.html (SPA fallback),
// so /catalog, /status, ... load the app directly; in-app navigation uses the History API.

import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

export type Route =
  | { readonly name: "landing" }
  | { readonly name: "catalog" }
  | { readonly name: "resolution"; readonly id: string }
  | { readonly name: "resolution-lookup" }
  | { readonly name: "benchmark" }
  | { readonly name: "status" }
  | { readonly name: "connect" }
  | { readonly name: "not-found" };

export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/" || path === "") return { name: "landing" };
  if (path === "/catalog") return { name: "catalog" };
  if (path === "/benchmark") return { name: "benchmark" };
  if (path === "/status") return { name: "status" };
  if (path === "/connect") return { name: "connect" };
  if (path === "/resolutions") return { name: "resolution-lookup" };
  const resolution = /^\/resolutions\/([^/]{1,200})$/.exec(path);
  if (resolution?.[1] !== undefined) {
    let id: string;
    try {
      id = decodeURIComponent(resolution[1]);
    } catch {
      id = resolution[1];
    }
    return { name: "resolution", id };
  }
  return { name: "not-found" };
}

const NAVIGATE_EVENT = "lemma:navigate";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

export function usePathname(fallback = "/"): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => fallback,
  );
}

export function navigate(to: string): void {
  if (to === window.location.pathname) return;
  window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  window.scrollTo(0, 0);
}

export function isInternalPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { readonly href: string; readonly children: ReactNode };

/**
 * Anchor for both internal routes (client-side navigation) and allowlisted external pages
 * (new tab, no referrer, no opener). Callers pass static or already-validated hrefs only.
 */
export function Link({ href, children, onClick, ...rest }: LinkProps) {
  if (!isInternalPath(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return (
    <a href={href} onClick={handle} {...rest}>
      {children}
    </a>
  );
}

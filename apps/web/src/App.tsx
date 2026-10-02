import { useEffect } from "react";

import { ClosingCta } from "./components/ClosingCta.js";
import { Footer } from "./components/Footer.js";
import { Guarantees } from "./components/Guarantees.js";
import { Hero } from "./components/Hero.js";
import { ProductMock } from "./components/mock/ProductMock.js";
import { Nav } from "./components/Nav.js";
import { BenchmarkPage } from "./pages/BenchmarkPage.js";
import { CatalogPage } from "./pages/CatalogPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { ResolutionLookupPage, ResolutionPage } from "./pages/ResolutionPage.js";
import { StatusPage } from "./pages/StatusPage.js";
import { matchRoute, usePathname, type Route } from "./router.js";

function Landing() {
  return (
    <>
      <Hero />
      <ProductMock />
      <Guarantees />
      <ClosingCta />
    </>
  );
}

const titles: Record<Route["name"], string> = {
  landing: "Lemma",
  catalog: "Catalog · Lemma",
  resolution: "Resolution · Lemma",
  "resolution-lookup": "Resolutions · Lemma",
  benchmark: "Benchmark · Lemma",
  status: "Status · Lemma",
  "not-found": "Not found · Lemma",
};

const navActive: Partial<Record<Route["name"], string>> = { catalog: "/catalog", status: "/status" };

function Page({ route }: { readonly route: Route }) {
  switch (route.name) {
    case "landing":
      return <Landing />;
    case "catalog":
      return <CatalogPage />;
    case "resolution":
      return <ResolutionPage id={route.id} />;
    case "resolution-lookup":
      return <ResolutionLookupPage />;
    case "benchmark":
      return <BenchmarkPage />;
    case "status":
      return <StatusPage />;
    case "not-found":
      return <NotFoundPage />;
  }
}

/** `path` pins the route for server rendering and tests; the browser uses location.pathname. */
export function App({ path }: { readonly path?: string } = {}) {
  const current = usePathname(path ?? "/");
  const route = matchRoute(path ?? current);

  useEffect(() => {
    document.title = titles[route.name];
  }, [route.name]);

  return (
    <>
      <Nav active={navActive[route.name] ?? null} />
      <main>
        <Page route={route} />
      </main>
      <Footer />
    </>
  );
}

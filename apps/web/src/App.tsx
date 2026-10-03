import { lazy, Suspense, useEffect } from "react";

import { ClosingCta } from "./components/ClosingCta.js";
import { Footer } from "./components/Footer.js";
import { Guarantees } from "./components/Guarantees.js";
import { Hero } from "./components/Hero.js";
import { HowItWorks } from "./components/HowItWorks.js";
import { LiveProof } from "./components/LiveProof.js";
import { Nav } from "./components/Nav.js";
import { Pricing } from "./components/Pricing.js";
import { WhyArbitrum } from "./components/WhyArbitrum.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { matchRoute, usePathname, type Route } from "./router.js";

// Dashboard pages load on demand so the landing page ships only what it renders.
const BenchmarkPage = lazy(() => import("./pages/BenchmarkPage.js").then((m) => ({ default: m.BenchmarkPage })));
const CatalogPage = lazy(() => import("./pages/CatalogPage.js").then((m) => ({ default: m.CatalogPage })));
const ConnectPage = lazy(() => import("./pages/ConnectPage.js").then((m) => ({ default: m.ConnectPage })));
const ResolutionPage = lazy(() => import("./pages/ResolutionPage.js").then((m) => ({ default: m.ResolutionPage })));
const ResolutionLookupPage = lazy(() => import("./pages/ResolutionPage.js").then((m) => ({ default: m.ResolutionLookupPage })));
const StatusPage = lazy(() => import("./pages/StatusPage.js").then((m) => ({ default: m.StatusPage })));

function Landing() {
  return (
    <>
      <Hero />
      <LiveProof />
      <HowItWorks />
      <Pricing />
      <Guarantees />
      <WhyArbitrum />
      <ClosingCta />
    </>
  );
}

const titles: Record<Route["name"], string> = {
  landing: "Lemma · Verified integrations for coding agents on Arbitrum",
  catalog: "Catalog · Lemma",
  resolution: "Resolution · Lemma",
  "resolution-lookup": "Resolutions · Lemma",
  benchmark: "Benchmark · Lemma",
  status: "Status · Lemma",
  connect: "Connect · Lemma",
  "not-found": "Not found · Lemma",
};

const navActive: Partial<Record<Route["name"], string>> = {
  catalog: "/catalog",
  benchmark: "/benchmark",
  status: "/status",
  resolution: "/resolutions",
  "resolution-lookup": "/resolutions",
};

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
    case "connect":
      return <ConnectPage />;
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
        <Suspense fallback={<div className="min-h-screen" />}>
          <Page route={route} />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

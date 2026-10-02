import { ClosingCta } from "./components/ClosingCta.js";
import { Footer } from "./components/Footer.js";
import { Guarantees } from "./components/Guarantees.js";
import { Hero } from "./components/Hero.js";
import { ProductMock } from "./components/mock/ProductMock.js";
import { Nav } from "./components/Nav.js";

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <ProductMock />
        <Guarantees />
        <ClosingCta />
      </main>
      <Footer />
    </>
  );
}

import { Hero } from "./components/Hero.js";
import { Nav } from "./components/Nav.js";

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
      </main>
    </>
  );
}

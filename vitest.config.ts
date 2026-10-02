import { defineConfig } from "vitest/config";

// Root test scope. Restricts discovery to workspace test directories so that
// vendored Foundry libraries (contracts/lib), catalog fixtures, and release
// payloads (which contain their own acceptance tests) are never collected here.
export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.{ts,tsx}",
      "apps/*/test/**/*.test.{ts,tsx}",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "contracts/**"],
  },
});

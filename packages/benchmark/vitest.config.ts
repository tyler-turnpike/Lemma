import { defineConfig } from "vitest/config";

// tasks/ holds benchmark-owned acceptance tests; they only run inside temp workspaces.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});

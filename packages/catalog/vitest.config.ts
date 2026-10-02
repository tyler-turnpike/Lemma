import { defineConfig } from "vitest/config";

// Payloads and fixtures carry their own acceptance tests; they only run inside temp workspaces.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});

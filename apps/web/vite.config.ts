import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dev only: forward API calls to a locally running apps/server (npm run dev:server).
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/facilitator": "http://localhost:3000",
    },
  },
  build: {
    sourcemap: false,
  },
});

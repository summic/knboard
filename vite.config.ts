import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: Vite serves the web app on 5173 and proxies /api to the Node server (6789).
// Build: emits static assets to dist/web, which the Node server serves in prod.
export default defineConfig({
  root: "src/web",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:6789",
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});

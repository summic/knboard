import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "src/web");

// Dev: Vite serves the web app on 5173 and proxies API plus published user files to the Node server (6789).
// Build: emits static assets to dist/web (main app + the standalone /demo.html upload-animation page).
export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:6789",
      "/u": "http://localhost:6789",
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        demo: resolve(root, "demo.html"),
      },
    },
  },
});

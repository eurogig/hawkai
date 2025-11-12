import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// GitHub Pages base path - set to repo name if deploying to /repo-name, or "/" for root
const base = process.env.GITHUB_PAGES_BASE || "/";

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false
  }
});

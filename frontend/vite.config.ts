import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dashboard SPA. In dev, Vite serves it and proxies API/auth traffic to the
// backend on :8080; in prod the backend serves the built assets itself (WEB_ROOT).
// envDir points at the repo root so the frontend reads the same layered .env files
// as the backend (homectl-reference docs/conventions.md — env layering).
export default defineConfig({
  plugins: [react()],
  envDir: "..",
  server: {
    port: 3000,
    proxy: {
      "/api": "http://localhost:8080",
      "/auth": "http://localhost:8080",
      "/health": "http://localhost:8080",
    },
  },
});

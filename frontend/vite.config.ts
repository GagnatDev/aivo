import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dashboard SPA. In dev, Vite serves it and proxies API traffic to the backend
// on :8080; in prod the sidecar fronts the backend, which serves the built assets
// itself (WEB_ROOT). envDir points at the repo root so the frontend reads the same
// layered .env files as the backend (homectl-reference docs/conventions.md — env
// layering). No /auth proxy: the app mounts no OAuth routes — the sidecar owns them.
export default defineConfig({
  plugins: [react()],
  envDir: "..",
  server: {
    port: 3000,
    proxy: {
      "/api": "http://localhost:8080",
      "/health": "http://localhost:8080",
    },
  },
});

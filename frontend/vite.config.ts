import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The dashboard SPA. In dev, Vite serves it and proxies API traffic to the backend
// on :8080; in prod the sidecar fronts the backend, which serves the built assets
// itself (WEB_ROOT). envDir points at the repo root so the frontend reads the same
// layered .env files as the backend (homectl-reference docs/conventions.md — env
// layering). No /auth proxy: the app mounts no OAuth routes — the sidecar owns them.
//
// PWA: aivo is installable to the Home Screen as "Aivo" (the AI assistant). Every
// install-discovery asset — manifest, icons, favicon — lives under /static/, the one
// path the homectl-auth-proxy sidecar serves WITHOUT a session cookie, so the OS can
// fetch the manifest and icons anonymously at install time (they would otherwise 302
// to central login). See unforked docs/auth-sidecar-migration.md for the gotchas
// baked in below: (1) navigateFallbackDenylist excludes the sidecar/API/OAuth paths
// so the precached shell never answers a top-level /auth or /youtube callback and
// swallows the authorization code; (2) the SW is unregistered before a login
// navigation in src/auth/auth.ts so 401s actually reach the sidecar.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      // Non-precache assets the manifest/HTML reference. Under /static/ so the
      // sidecar serves them without a session.
      includeAssets: [
        "static/favicon.ico",
        "static/pwa-icon.svg",
        "static/apple-touch-icon-180x180.png",
      ],
      manifestFilename: "static/manifest.webmanifest",
      manifest: {
        name: "Aivo",
        short_name: "Aivo",
        description: "Aivo — your AI assistant dashboard",
        theme_color: "#0f1218",
        background_color: "#0f1218",
        display: "standalone",
        scope: "/",
        start_url: "/",
        lang: "en",
        icons: [
          { src: "/static/pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "/static/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/static/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/static/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,ico}"],
        navigateFallback: "index.html",
        // These prefixes belong to the backend/sidecar, not the SPA: the OAuth
        // callback + logout (/auth/*, owned by the auth-proxy sidecar), the
        // dashboard API (/api/*), the one-time YouTube consent callback
        // (/youtube/*), and the k8s health probe (/health). If the SW answered
        // their navigations from the precached index.html, an /auth or /youtube
        // authorization code would never reach the server and login would fail
        // with OAuth state errors (unforked docs/auth-sidecar-migration.md).
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/youtube\//, /^\/health/],
      },
    }),
  ],
  envDir: "..",
  server: {
    port: 3000,
    proxy: {
      "/api": "http://localhost:8080",
      "/health": "http://localhost:8080",
    },
  },
});

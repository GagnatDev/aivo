import path from "node:path";
import express, { type Express } from "express";
import type { AuthProvider } from "./auth/index.js";
import { httpLogger } from "./logger.js";
import { dashboardRouter, type DashboardDeps } from "./routes/dashboard/index.js";
import { healthRouter } from "./routes/health.js";
import { youtubeOauthRouter, type YoutubeOauthRouteConfig } from "./routes/youtubeOauth.js";

export interface AppOptions {
  /** Mounts the one-time YouTube OAuth handshake when the client config exists. */
  youtubeOauth?: YoutubeOauthRouteConfig;
  /** Mounts the authenticated dashboard API when provided. */
  auth?: {
    provider: AuthProvider;
    dashboard: DashboardDeps;
  };
  /**
   * Directory of the built SPA (env.WEB_ROOT, set in the Docker image). Unset in
   * dev — Vite serves the frontend. The SPA is auth-agnostic: in prod the sidecar
   * only proxies the HTML shell to an already-authenticated session (a top-level
   * navigation without a session is 302'd to central login before it ever reaches
   * this app), so the shell can be served without any token handling here.
   */
  webRoot?: string;
}

// Path prefixes owned by the API surfaces — everything else falls through to the
// SPA's index.html so client-side routes survive a full page load. `/auth/` stays
// listed defensively: the sidecar intercepts its callback/logout before they reach
// this app, so any `/auth/*` that does arrive should 404, not serve the shell.
const NON_SPA_PREFIXES = ["/api/", "/auth/", "/health", "/youtube/"];

/**
 * Assemble the Express application. The HTTP surface is `/health` (k8s probes), the
 * one-time YouTube OAuth callback, the authenticated dashboard API under
 * /api/dashboard, and the static dashboard SPA — one pod serves everything
 * (PRD §5.1). User auth is handled by the homectl-auth-proxy sidecar in front of
 * this app (see auth/sidecarProvider.ts); this app mounts no OAuth routes. Returns
 * the app without listening so it can be driven in-process by supertest.
 */
export function buildApp(options: AppOptions = {}): Express {
  const app = express();
  // Behind the K8s Ingress (when one exists): trust X-Forwarded-* for req.ip.
  app.set("trust proxy", true);
  app.use(httpLogger);
  app.use(express.json({ limit: "1mb" }));
  app.use(healthRouter);
  if (options.youtubeOauth) app.use(youtubeOauthRouter(options.youtubeOauth));

  if (options.auth) {
    const { provider, dashboard } = options.auth;
    app.use(dashboardRouter(provider, dashboard));
  }

  if (options.webRoot) {
    const webRoot = path.resolve(options.webRoot);
    app.use(
      express.static(webRoot, {
        setHeaders(res, filePath) {
          // The PWA service worker must always be revalidated, or a client
          // pins itself to a stale build: a cached sw.js means the browser
          // never discovers a new worker (and its fresh precache manifest).
          // Same for the SW registration shim. index.html is the SPA's version
          // anchor — it references hashed assets, so it too must never be
          // cached. Everything else (hashed JS/CSS, /static/ icons) keeps the
          // default long-lived caching.
          const base = path.basename(filePath);
          if (base === "sw.js" || base === "registerSW.js" || base === "index.html") {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      if (NON_SPA_PREFIXES.some((p) => req.path.startsWith(p))) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(webRoot, "index.html"));
    });
  }

  return app;
}

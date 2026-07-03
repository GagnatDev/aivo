import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import type { AuthProvider } from "./auth/index.js";
import { httpLogger } from "./logger.js";
import { dashboardRouter, type DashboardDeps } from "./routes/dashboard/index.js";
import { healthRouter } from "./routes/health.js";
import { youtubeOauthRouter, type YoutubeOauthRouteConfig } from "./routes/youtubeOauth.js";

export interface AppOptions {
  /** Mounts the one-time YouTube OAuth handshake when the client config exists. */
  youtubeOauth?: YoutubeOauthRouteConfig;
  /** Mounts /auth/* and the authenticated dashboard API when provided. */
  auth?: {
    provider: AuthProvider;
    /** Where the OAuth callback lands (env.AUTH_CALLBACK_PATH). */
    callbackPath: string;
    dashboard: DashboardDeps;
  };
  /**
   * Directory of the built SPA (env.WEB_ROOT, set in the Docker image). Unset in
   * dev — Vite serves the frontend. Served unauthenticated: access tokens live in
   * browser memory only, so the HTML shell can never carry one; the SPA gates
   * itself by bootstrapping a token and bouncing to /auth/login when it has none.
   */
  webRoot?: string;
}

// Path prefixes owned by the API/auth surfaces — everything else falls through to
// the SPA's index.html so client-side routes survive a full page load.
const NON_SPA_PREFIXES = ["/api/", "/auth/", "/health", "/youtube/"];

/**
 * Assemble the Express application. The HTTP surface is `/health` (k8s probes), the
 * one-time YouTube OAuth callback, the homectl-auth login/callback/logout trio, the
 * authenticated dashboard API under /api/dashboard, and the static dashboard SPA —
 * one pod serves everything (PRD §5.1). Returns the app without listening so it can
 * be driven in-process by supertest.
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
    const { provider, callbackPath, dashboard } = options.auth;
    // The OAuth state cookie round-trips through the callback (vendored client).
    app.use(cookieParser());
    app.get("/auth/login", provider.loginHandler);
    app.get(callbackPath, provider.callbackHandler);
    app.post("/auth/logout", provider.logoutHandler);
    app.use(dashboardRouter(provider, dashboard));
  }

  if (options.webRoot) {
    const webRoot = path.resolve(options.webRoot);
    app.use(express.static(webRoot));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      if (NON_SPA_PREFIXES.some((p) => req.path.startsWith(p))) return next();
      res.sendFile(path.join(webRoot, "index.html"));
    });
  }

  return app;
}

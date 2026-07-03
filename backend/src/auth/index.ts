import type { RequestHandler } from "express";
import { createDevAuthProvider } from "./devProvider.js";
import { createHomectlAuthProvider } from "./homectlProvider.js";

/**
 * Pluggable auth for the dashboard HTTP surface (workbench pattern, see
 * homectl-reference docs/application-patterns.md §1): `dev` is a fixed local
 * principal so the whole stack runs offline in dev and tests; `homectl` is the
 * real OAuth2 flow against auth.homectl.no. Selected once at the composition
 * root from `env.authMode`.
 */
export type AuthMode = "dev" | "homectl";

export interface AuthProviderConfig {
  mode: AuthMode;
  authServiceUrl: string;
  clientId: string;
  /** Required when mode is `homectl` (validated by the env schema). */
  clientSecret: string | null;
  appBaseUrl: string;
  callbackPath: string;
}

/** The four handlers every provider exposes; app.ts mounts them uniformly. */
export interface AuthProvider {
  /** Populates `req.user` (the auth principal) or ends the request with 401/redirect. */
  authMiddleware: RequestHandler;
  /** GET /auth/login?next=<path> — starts the login flow. */
  loginHandler: RequestHandler;
  /** GET <callbackPath> — completes the OAuth code exchange. */
  callbackHandler: RequestHandler;
  /** POST /auth/logout — ends the auth-service session. */
  logoutHandler: RequestHandler;
}

export function createAuthProvider(config: AuthProviderConfig): AuthProvider {
  switch (config.mode) {
    case "dev":
      return createDevAuthProvider();
    case "homectl": {
      if (!config.clientSecret) {
        throw new Error("AIVO_CLIENT_SECRET is required when AUTH_MODE=homectl");
      }
      return createHomectlAuthProvider({
        authServiceUrl: config.authServiceUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        appBaseUrl: config.appBaseUrl,
        callbackPath: config.callbackPath,
      });
    }
  }
}

import type { RequestHandler } from "express";
import { createDevAuthProvider } from "./devProvider.js";
import { createSidecarAuthProvider } from "./sidecarProvider.js";

/**
 * The auth principal the sidecar (or the dev provider) resolves per request.
 * `role` is Aivo's app-specific role from homectl-auth (`owner` for the single
 * owner in v1); `null` when the user has no role in this app.
 */
export type AuthUser = {
  id: string;
  email: string;
  role: string | null;
};

// The verified principal, attached by authMiddleware. `middleware/resolveUser.ts`
// adds the app-side `userId`/`appUser` derived from it.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Pluggable auth for the dashboard HTTP surface. Aivo integrates with homectl-auth
 * via the **auth sidecar** (homectl-auth docs/sidecar/integration.md): in prod a
 * `homectl-auth-proxy` container fronts this app, runs the OAuth flow, and injects
 * verified `X-Homectl-*` identity headers — the app does no auth work, just reads
 * them (`sidecar` mode). `dev` is a fixed local principal so the whole stack runs
 * offline in dev and tests (the sidecar's "Option A" local pattern). Selected once
 * at the composition root from `env.authMode`.
 */
export type AuthMode = "dev" | "sidecar";

export interface AuthProviderConfig {
  mode: AuthMode;
}

/**
 * The single handler every provider exposes; app.ts mounts it in front of the
 * dashboard API. Login/callback/logout are owned entirely by the sidecar (its
 * CALLBACK_PATH/LOGOUT_PATH are intercepted before reaching this app), so this
 * app mounts no OAuth routes.
 */
export interface AuthProvider {
  /** Populates `req.user` (the auth principal) or ends the request with 401. */
  authMiddleware: RequestHandler;
}

export function createAuthProvider(config: AuthProviderConfig): AuthProvider {
  switch (config.mode) {
    case "dev":
      return createDevAuthProvider();
    case "sidecar":
      return createSidecarAuthProvider();
  }
}

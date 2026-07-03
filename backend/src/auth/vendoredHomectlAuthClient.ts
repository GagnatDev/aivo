/**
 * VENDORED from gagnatdev/homectl-auth `packages/client/src/server.ts` (v0.1.0).
 *
 * Aivo's build environments don't all have GitHub Packages (`read:packages`) auth
 * yet, so the published `@gagnatdev/homectl-auth-client` can't be a package.json
 * dependency without breaking `pnpm install --frozen-lockfile`. The module is small
 * and stable, so it is vendored verbatim with two local deviations (marked AIVO):
 *  1. `loginHandler` — an explicit login-initiation endpoint. Aivo serves the SPA
 *     shell unauthenticated (access tokens live only in JS memory, so a plain HTML
 *     request can never carry a Bearer token); the SPA starts the OAuth dance by
 *     navigating to `GET /auth/login?next=<path>`.
 *  2. The upstream callbackHandler declared an unused `tokenRes` variable; dropped.
 * When registry auth lands in CI/Docker, replace this file with the package import.
 *
 * Requires `cookie-parser` to be mounted (callbackHandler reads `req.cookies`).
 */

import { createHmac, randomBytes } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

// ── Types ──────────────────────────────────────────────────────────────────

export type AuthClientOptions = {
  /** Base URL of the auth service, e.g. https://auth.homectl.no */
  authServiceUrl: string;
  /** JWKS URL — defaults to ${authServiceUrl}/.well-known/jwks.json */
  jwksUrl?: string;
  /** The app's client_id as registered in the auth service config */
  clientId: string;
  /** The app's client_secret (read from env in consuming app) */
  clientSecret: string;
  /** The public-facing base URL of the consuming app, e.g. https://aivo.homectl.no */
  appBaseUrl: string;
  /** Path where the auth callback is handled — default /auth/callback */
  callbackPath?: string;
  /**
   * Optional: override the JWKS key provider (for testing with local key pairs).
   * Receives a JWTVerifyGetKey-compatible function (e.g. createLocalJWKSet output).
   */
  _jwksProvider?: Parameters<typeof jwtVerify>[1];
};

export type AuthUser = {
  id: string;
  email: string;
  isAdmin: boolean;
  /** The user's role in this specific app (from apps[] claim matching clientId) */
  role: string | null;
};

// Extend Express Request with user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ── State cookie ───────────────────────────────────────────────────────────

const STATE_COOKIE_NAME = "homectl_auth_state";
const STATE_COOKIE_MAX_AGE = 10 * 60 * 1000; // 10 minutes

type StateCookiePayload = {
  nonce: string;
  originalUrl: string;
};

function signStateCookie(payload: StateCookiePayload, secret: string): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString("base64");
  const sig = createHmac("sha256", secret).update(b64).digest("hex");
  return `${b64}.${sig}`;
}

function verifyStateCookie(value: string, secret: string): StateCookiePayload | null {
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expectedSig = createHmac("sha256", secret).update(b64!).digest("hex");
  if (sig !== expectedSig) return null;
  try {
    return JSON.parse(Buffer.from(b64!, "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export type AuthClientResult = {
  authMiddleware: RequestHandler;
  /** AIVO ADDITION: starts the OAuth flow from a plain navigation (see file header). */
  loginHandler: RequestHandler;
  callbackHandler: RequestHandler;
  logoutHandler: RequestHandler;
};

export function createAuthClient(options: AuthClientOptions): AuthClientResult {
  const {
    authServiceUrl,
    clientId,
    clientSecret,
    appBaseUrl,
    callbackPath = "/auth/callback",
  } = options;

  const jwksUrl = options.jwksUrl ?? `${authServiceUrl}/.well-known/jwks.json`;
  const JWKS = options._jwksProvider ?? createRemoteJWKSet(new URL(jwksUrl));
  const redirectUri = `${appBaseUrl}${callbackPath}`;

  function isHtmlRequest(req: Request): boolean {
    const accept = req.headers.accept ?? "";
    return accept.includes("text/html");
  }

  // ── authMiddleware ─────────────────────────────────────────────────────

  const authMiddleware: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    if (!token) {
      if (isHtmlRequest(req)) {
        redirectToLogin(req.originalUrl || "/", res);
      } else {
        res.status(401).json({ error: "unauthorized" });
      }
      return;
    }

    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: authServiceUrl,
        audience: clientId,
        algorithms: ["RS256"],
      });

      req.user = extractUser(payload, clientId);
      next();
    } catch {
      if (isHtmlRequest(req)) {
        redirectToLogin(req.originalUrl || "/", res);
      } else {
        res.status(401).json({ error: "invalid_token" });
      }
    }
  };

  function redirectToLogin(originalUrl: string, res: Response): void {
    const nonce = randomBytes(16).toString("hex");
    const stateCookieValue = signStateCookie({ nonce, originalUrl }, clientSecret);

    res.cookie(STATE_COOKIE_NAME, stateCookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: STATE_COOKIE_MAX_AGE,
    });

    const authorizeUrl = new URL(`${authServiceUrl}/authorize`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", nonce);

    res.redirect(302, authorizeUrl.toString());
  }

  // ── loginHandler (AIVO ADDITION) ───────────────────────────────────────

  const loginHandler: RequestHandler = (req: Request, res: Response): void => {
    const next = typeof req.query.next === "string" ? req.query.next : "/";
    // Only relative in-app paths — never an absolute URL — to prevent open redirects.
    const returnTo = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    redirectToLogin(returnTo, res);
  };

  // ── callbackHandler ────────────────────────────────────────────────────

  const callbackHandler: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    const { code, state } = req.query as Record<string, string>;

    const stateCookie = (req.cookies as Record<string, string>)[STATE_COOKIE_NAME];
    if (!stateCookie) {
      res.status(400).json({ error: "missing_state_cookie" });
      return;
    }

    const statePayload = verifyStateCookie(stateCookie, clientSecret);
    if (!statePayload) {
      res.status(400).json({ error: "invalid_state_cookie" });
      return;
    }

    // Clear state cookie (single-use)
    res.clearCookie(STATE_COOKIE_NAME);

    if (state !== statePayload.nonce) {
      res.status(400).json({ error: "state_mismatch" });
      return;
    }

    if (!code) {
      res.status(400).json({ error: "missing_code" });
      return;
    }

    // Exchange code for token (server-to-server)
    try {
      const response = await fetch(`${authServiceUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        res.status(400).json({ error: "token_exchange_failed" });
        return;
      }
      // Token is discarded — refresh cookie was set on auth.homectl.no
      // Browser helper will bootstrap access token via /refresh on page load
    } catch {
      res.status(500).json({ error: "token_exchange_error" });
      return;
    }

    // Redirect to the original URL
    const redirectTo = statePayload.originalUrl || "/";
    res.redirect(302, redirectTo);
  };

  // ── logoutHandler ──────────────────────────────────────────────────────

  const logoutHandler: RequestHandler = (_req: Request, res: Response): void => {
    // Render a page that fires a cross-origin POST to the auth service /logout,
    // then redirects back to the app's home.
    const logoutHtml = `<!DOCTYPE html>
<html>
<head><title>Logging out…</title></head>
<body>
<script>
(async function() {
  try {
    await fetch('${authServiceUrl}/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch (_) {}
  window.location.href = '${appBaseUrl}/';
})();
</script>
</body>
</html>`;
    res.type("html").send(logoutHtml);
  };

  return { authMiddleware, loginHandler, callbackHandler, logoutHandler };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractUser(payload: JWTPayload, clientId: string): AuthUser {
  const apps = (payload.apps as Array<{ appId: string; role: string }>) ?? [];
  const appEntry = apps.find((a) => a.appId === clientId);

  return {
    id: payload.sub as string,
    email: payload.email as string,
    isAdmin: (payload.isAdmin as boolean) ?? false,
    role: appEntry?.role ?? null,
  };
}

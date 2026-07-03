import type { AuthProvider } from "./index.js";

/** The fixed local principal's auth subject (override per-request via `x-dev-sub`). */
export const DEV_AUTH_SUB = "dev-owner";

/**
 * Offline auth for local dev and tests: every request is authenticated as a fixed
 * owner-role principal, no auth service involved (workbench devProvider pattern).
 * Tests can impersonate other subjects with an `x-dev-sub` header, and drop the
 * owner role with `x-dev-role` to exercise the authorization paths.
 */
export function createDevAuthProvider(): AuthProvider {
  return {
    authMiddleware: (req, _res, next) => {
      const subHeader = req.headers["x-dev-sub"];
      const roleHeader = req.headers["x-dev-role"];
      const sub = typeof subHeader === "string" && subHeader !== "" ? subHeader : DEV_AUTH_SUB;
      const role = typeof roleHeader === "string" ? roleHeader : "owner";
      req.user = {
        id: sub,
        email: `${sub}@dev.local`,
        isAdmin: role === "owner",
        role: role === "" ? null : role,
      };
      next();
    },
    loginHandler: (req, res) => {
      const next = typeof req.query.next === "string" ? req.query.next : "/";
      const returnTo = next.startsWith("/") && !next.startsWith("//") ? next : "/";
      res.redirect(302, returnTo);
    },
    callbackHandler: (_req, res) => {
      res.redirect(302, "/");
    },
    logoutHandler: (_req, res) => {
      res.redirect(302, "/");
    },
  };
}

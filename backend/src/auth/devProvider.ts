import type { AuthProvider } from "./index.js";

/** The fixed local principal's auth subject (override per-request via `x-dev-sub`). */
export const DEV_AUTH_SUB = "dev-owner";

/**
 * Offline auth for local dev and tests: every request is authenticated as a fixed
 * owner-role principal, no sidecar and no auth service involved. This is the
 * sidecar guide's "Option A" — run the app directly and default to a fixed local
 * user when the `X-Homectl-*` headers are absent (homectl-auth
 * docs/sidecar/integration.md §7). Tests can impersonate other subjects with an
 * `x-dev-sub` header, and drop the owner role with `x-dev-role` to exercise the
 * authorization paths.
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
        role: role === "" ? null : role,
      };
      next();
    },
  };
}

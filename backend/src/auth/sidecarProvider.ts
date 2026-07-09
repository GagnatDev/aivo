import type { AuthProvider } from "./index.js";

/** Identity headers the homectl-auth-proxy sidecar injects on every proxied request. */
const USER_HEADER = "x-homectl-user";
const EMAIL_HEADER = "x-homectl-email";
const ROLE_HEADER = "x-homectl-role";

/**
 * Production auth behind the homectl-auth-proxy sidecar
 * (homectl-auth docs/sidecar/integration.md §4). The sidecar has already run the
 * OAuth flow, verified the RS256 token, and — crucially — **stripped any inbound
 * `X-Homectl-*` headers before injecting its own** (its header-stripping guarantee
 * is what makes these trustworthy). So the app does zero auth work: it reads the
 * verified identity straight off the headers.
 *
 * The trust boundary is the network, not a signature: this is safe *only* because
 * the app is reachable exclusively through the sidecar (Service → :4180 sidecar →
 * :8080 app; the app port is never an ingress/Service target — see k8s/deployment.yml
 * and the doc's Security notes). A missing `X-Homectl-User` means the sidecar did
 * not authenticate the request, so we 401 rather than inventing a principal.
 *
 * We deliberately read only the injected headers, not the `Authorization: Bearer`
 * JWT the sidecar also forwards — homectl-auth's global `isAdmin` claim is not
 * projected into a header by design, so the app's owner gate keys off the aivo
 * app role alone (see middleware/resolveUser.ts).
 */
export function createSidecarAuthProvider(): AuthProvider {
  return {
    authMiddleware: (req, res, next) => {
      const id = req.get(USER_HEADER);
      if (!id) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const role = req.get(ROLE_HEADER);
      req.user = {
        id,
        email: req.get(EMAIL_HEADER) ?? "",
        // Header absent (user has no role in this app) → null, matching AuthUser.
        role: role && role !== "" ? role : null,
      };
      next();
    },
  };
}

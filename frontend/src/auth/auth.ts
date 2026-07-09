/**
 * The SPA is auth-agnostic under the homectl-auth-proxy sidecar
 * (homectl-auth docs/sidecar/integration.md §5): it holds no token, makes plain
 * same-origin requests (the browser's `hs_session` cookie rides along
 * automatically), and knows nothing about auth.homectl.no. The sidecar runs the
 * login redirect for a top-level navigation and returns 401 for an XHR.
 *
 * This module is a thin seam over those two facts so call sites stay tidy:
 *  - `fetch` is a plain same-origin fetch.
 *  - `login()` bounces to a full page load so the sidecar can do the top-level
 *    login redirect (called when an API request comes back 401).
 *  - `logout()` navigates to the sidecar's logout path, which clears the session.
 *
 * With `VITE_DISABLE_AUTH=true` (the committed .env.development overlay) there is
 * no sidecar and the backend's dev provider supplies a fixed principal, so logout
 * has nowhere to go and just returns home.
 */
export interface AuthClient {
  /** Same-origin fetch; the sidecar injects the verified identity server-side. */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Full-page navigation so the sidecar can run the top-level login redirect. */
  login(): void;
  /** Navigate to the sidecar logout path (clears `hs_session`), then home. */
  logout(): void;
}

const disableAuth = import.meta.env.VITE_DISABLE_AUTH === "true";

/** Path the sidecar handles for logout (its LOGOUT_PATH default). */
const LOGOUT_PATH = "/auth/logout";

export const auth: AuthClient = {
  fetch: (input, init) => fetch(input, init),
  // A full page load at "/" lets the sidecar 302 an unauthenticated top-level
  // navigation to central login before the shell is served.
  login: () => {
    window.location.href = "/";
  },
  logout: () => {
    window.location.href = disableAuth ? "/" : LOGOUT_PATH;
  },
};

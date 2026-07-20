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

/**
 * Full-page navigation to `to` that is guaranteed to reach the auth sidecar.
 *
 * The PWA service worker answers navigations from its precache
 * (`navigateFallback: index.html`), so a plain `location.href = "/"` is served
 * from cache and never produces a network request — the sidecar never gets the
 * chance to 302 an expired session to central login, and an installed PWA would
 * sit on the cached shell forever (unforked docs/auth-sidecar-migration.md).
 * Unregistering the service worker(s) first makes the next top-level navigation
 * hit the network; the worker re-registers (and re-precaches) after login.
 */
async function navigateThroughSidecar(to: string): Promise<void> {
  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    } catch {
      // Best effort — navigate regardless.
    }
  }
  window.location.href = to;
}

export const auth: AuthClient = {
  fetch: (input, init) => fetch(input, init),
  // A full page load at "/" lets the sidecar 302 an unauthenticated top-level
  // navigation to central login before the shell is served.
  login: () => {
    void navigateThroughSidecar("/");
  },
  logout: () => {
    void navigateThroughSidecar(disableAuth ? "/" : LOGOUT_PATH);
  },
};

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
 *  - `logout()` submits a top-level POST to the sidecar's logout path, which
 *    clears the session and 302s home (where the now session-less navigation is
 *    bounced to central login). The sidecar handles logout on POST only, so a
 *    plain `window.location` GET would fall through to the app and 404
 *    ("Cannot GET /auth/logout") — hence the hidden-form POST.
 *
 * Both navigations go through `throughSidecar`, which drops the PWA service
 * worker first so the browser actually asks the network (and thus the sidecar).
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
  /** POST to the sidecar logout path (clears `hs_session`), then land home. */
  logout(): void;
}

const disableAuth = import.meta.env.VITE_DISABLE_AUTH === "true";

/**
 * Path the sidecar handles for logout (its LOGOUT_PATH default). The sidecar
 * registers this as a POST route (`app.post(logoutPath, …)`); a GET is not its
 * route and is proxied through to the app, which 404s.
 */
const LOGOUT_PATH = "/auth/logout";

/**
 * Run `navigate` as a top-level navigation that is guaranteed to reach the auth
 * sidecar.
 *
 * The PWA service worker answers navigations from its precache
 * (`navigateFallback: index.html`), so a plain `location.href = "/"` — or the
 * sidecar's 302 home after logout — is served from cache and never produces a
 * network request: the sidecar never gets the chance to 302 a session-less
 * navigation to central login, and an installed PWA would sit on the cached
 * shell forever (unforked docs/auth-sidecar-migration.md). Unregistering the
 * service worker(s) first makes the next top-level navigation hit the network;
 * the worker re-registers (and re-precaches) after login.
 */
async function throughSidecar(navigate: () => void): Promise<void> {
  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    } catch {
      // Best effort — navigate regardless.
    }
  }
  navigate();
}

/** Full-page GET navigation to `to`, past the service worker. */
function navigateThroughSidecar(to: string): void {
  void throughSidecar(() => {
    window.location.href = to;
  });
}

/**
 * Top-level POST navigation to `to`, past the service worker. There is no
 * `location` API for a POST, so submit a hidden form and let the browser follow
 * the response's redirect.
 */
function postThroughSidecar(to: string): void {
  void throughSidecar(() => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = to;
    document.body.appendChild(form);
    form.submit();
  });
}

export const auth: AuthClient = {
  fetch: (input, init) => fetch(input, init),
  // A full page load at "/" lets the sidecar 302 an unauthenticated top-level
  // navigation to central login before the shell is served.
  login: () => {
    navigateThroughSidecar("/");
  },
  logout: () => {
    // Dev (no sidecar) has nowhere to log out — just return home.
    if (disableAuth) {
      navigateThroughSidecar("/");
      return;
    }
    // The sidecar owns logout as POST /auth/logout: it clears `hs_session` and
    // 302s to "/", where the now session-less top-level navigation is bounced to
    // central login. A GET falls through to the app and 404s, so drive a
    // top-level POST navigation instead.
    postThroughSidecar(LOGOUT_PATH);
  },
};

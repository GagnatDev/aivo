import {
  type AuthBrowserClient,
  createAuthBrowserClient,
} from "./vendoredHomectlAuthBrowserClient.js";

/**
 * The SPA-side auth seam, mirroring the backend's pluggable provider: with
 * `VITE_DISABLE_AUTH=true` (committed .env.development overlay) fetches pass
 * through unadorned and the backend's dev provider supplies the principal;
 * otherwise the vendored homectl-auth browser client bootstraps an in-memory
 * access token from the refresh cookie and attaches it as a Bearer header.
 */
export interface AuthClient {
  /** Resolve to true when authenticated; false means the caller should login(). */
  bootstrap(): Promise<boolean>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Full-page navigation that starts the OAuth flow, returning to `next`. */
  login(next: string): void;
  logout(): Promise<void>;
}

const disableAuth = import.meta.env.VITE_DISABLE_AUTH === "true";
const authServiceUrl = import.meta.env.VITE_AUTH_SERVICE_URL ?? "https://auth.homectl.no";

function createDevAuthClient(): AuthClient {
  return {
    bootstrap: () => Promise.resolve(true),
    fetch: (input, init) => fetch(input, init),
    login: () => {},
    logout: () => Promise.resolve(),
  };
}

function createHomectlAuthClient(): AuthClient {
  const client: AuthBrowserClient = createAuthBrowserClient({ authServiceUrl });
  return {
    bootstrap: async () => (await client.bootstrap()) !== null,
    fetch: (input, init) => client.authedFetch(input, init),
    login: (next) => {
      window.location.href = buildLoginUrl(next);
    },
    logout: () => client.logout(),
  };
}

/** The backend's login bounce (server-handled callback); `next` must stay relative. */
export function buildLoginUrl(next: string): string {
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return `/auth/login?next=${encodeURIComponent(safeNext)}`;
}

export const auth: AuthClient = disableAuth ? createDevAuthClient() : createHomectlAuthClient();

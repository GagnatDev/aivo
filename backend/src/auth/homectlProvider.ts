import type { AuthProvider } from "./index.js";
import { createAuthClient } from "./vendoredHomectlAuthClient.js";

export interface HomectlProviderConfig {
  authServiceUrl: string;
  clientId: string;
  clientSecret: string;
  appBaseUrl: string;
  callbackPath: string;
}

/**
 * Real OAuth2 against the centralized homectl-auth service. Thin adapter over the
 * (vendored) client: RS256 JWT verification via the service's JWKS, server-handled
 * callback (PRD §5.1 — the pod serves the homectl-auth callback), and the login
 * bounce for the SPA. Aivo maps the verified principal to a `users` row in
 * middleware/resolveUser.ts.
 */
export function createHomectlAuthProvider(config: HomectlProviderConfig): AuthProvider {
  return createAuthClient({
    authServiceUrl: config.authServiceUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    appBaseUrl: config.appBaseUrl,
    callbackPath: config.callbackPath,
  });
}

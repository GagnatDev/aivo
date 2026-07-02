import { Router } from "express";

/**
 * One-time YouTube OAuth handshake (docs/technical-overview.md: the only HTTP surface
 * besides /health). `/youtube/oauth/start` redirects the owner to Google's consent
 * screen; the callback exchanges the code and DISPLAYS the refresh token so the owner
 * can put it into the deployment secrets as YOUTUBE_OAUTH_REFRESH_TOKEN — the token is
 * deliberately never stored server-side (docs/data-model.md: secrets live in
 * aivo-secrets, not the DB). Only mounted when the OAuth client config exists; the
 * token shown belongs to whichever Google account consents, so the route leaks nothing
 * of ours — but the ingress should still be private.
 */

export interface YoutubeOauthRouteConfig {
  clientId: string;
  clientSecret: string;
  /** The public URL of the callback route, registered on the Google OAuth client. */
  redirectUrl: string;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

export function youtubeOauthRouter(cfg: YoutubeOauthRouteConfig): Router {
  const router = Router();

  router.get("/youtube/oauth/start", (_req, res) => {
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", cfg.redirectUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    // offline + consent force a refresh token to be issued even on re-authorization.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    res.redirect(url.toString());
  });

  router.get("/youtube/oauth/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!code) {
      res.status(400).type("text/plain").send("Missing ?code — start at /youtube/oauth/start");
      return;
    }
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUrl,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      res
        .status(502)
        .type("text/plain")
        .send(`Token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
      return;
    }
    const body = (await tokenRes.json()) as { refresh_token?: string };
    if (!body.refresh_token) {
      res
        .status(502)
        .type("text/plain")
        .send("Google returned no refresh_token — revoke the app's access and try again.");
      return;
    }
    res
      .type("text/plain")
      .send(
        "YouTube connected. Put this in aivo-secrets as YOUTUBE_OAUTH_REFRESH_TOKEN and " +
          `redeploy:\n\n${body.refresh_token}\n\nThis token was not stored anywhere else.`,
      );
  });

  return router;
}

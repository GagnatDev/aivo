import type { YoutubeStatus } from "../../lib/digests.js";

/**
 * How to give Aivo a fresh YouTube refresh token (#83). Recovering from an
 * `invalid_grant` otherwise means knowing that the consent route exists, that its
 * callback prints a refresh token, and which secret key it belongs to — none of which was
 * discoverable from the dashboard.
 *
 * The token deliberately never reaches the dashboard or the database (docs/data-model.md:
 * secrets live in `aivo-secrets`), so this is guidance plus a link — there is no field
 * here to paste it into. Open by default when something is actually broken, a quiet
 * disclosure otherwise.
 */
export function YoutubeReconnectGuide({
  youtube,
  open,
}: {
  youtube: YoutubeStatus;
  /** Expanded when the connection is what's wrong — a dead grant, or never connected. */
  open: boolean;
}) {
  return (
    <details className="digest-reconnect" open={open}>
      <summary>Reconnect YouTube (refresh the OAuth token)</summary>
      <ol className="digest-reconnect-steps">
        <li>
          {youtube.oauthStartPath ? (
            <a href={youtube.oauthStartPath} target="_blank" rel="noreferrer">
              Open the Google consent screen
            </a>
          ) : (
            <span>
              Open the consent screen — unavailable here: this deployment has no YouTube OAuth
              client configured (<code>YOUTUBE_OAUTH_CLIENT_ID</code>,{" "}
              <code>YOUTUBE_OAUTH_CLIENT_SECRET</code>, <code>YOUTUBE_OAUTH_REDIRECT_URL</code>).
            </span>
          )}{" "}
          and approve with the Google account whose subscriptions feed the digest.
        </li>
        <li>
          Copy the refresh token the callback page prints. It is shown once, and nowhere else.
        </li>
        <li>
          Put it in the <code>aivo-secrets</code> secret as{" "}
          <code>{youtube.refreshTokenSecretKey}</code>, then restart the deployment so it picks the
          new value up.
        </li>
        <li>
          Ask Aivo to <em>"run the digest now"</em> in #youtube to confirm it works.
        </li>
      </ol>
      <p className="muted digest-reconnect-note">
        The dashboard never receives or stores the token — by design it lives only in the deployment
        secrets.
      </p>
    </details>
  );
}

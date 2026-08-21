/**
 * The YouTube port's failure taxonomy, in the same spirit as llm/errors.ts: thrown at
 * the seam that knows *why* the call failed, so callers switch on the cause instead of
 * pattern-matching log strings. The digest pipeline maps these onto its persisted
 * failure kinds (digest/failure.ts).
 */

/**
 * Why a YouTube call failed:
 * - `auth`: the OAuth refresh token was rejected (expired or revoked). Permanent —
 *   the owner must re-authorize and swap `YOUTUBE_OAUTH_REFRESH_TOKEN`.
 * - `api`: the Data API itself errored (quota, 5xx, a bad request). Worth retrying on
 *   the next scheduled run without anyone doing anything.
 */
export type YoutubeErrorKind = "auth" | "api";

/** A failed YouTube call, tagged with the classified {@link YoutubeErrorKind}. */
export class YoutubeApiError extends Error {
  readonly kind: YoutubeErrorKind;
  /** The upstream HTTP status, when the failure came back as a response. */
  readonly status?: number;

  constructor(kind: YoutubeErrorKind, message: string, options?: { status?: number }) {
    super(message);
    this.name = "YoutubeApiError";
    this.kind = kind;
    if (options?.status !== undefined) this.status = options.status;
  }
}

/**
 * Classify a failed `POST /token` refresh-grant exchange. Google answers a dead refresh
 * token with `400 invalid_grant`; `invalid_client` / `unauthorized_client` mean the
 * OAuth client itself is wrong — all three need the owner to act, so they share the
 * `auth` kind. A 5xx (or anything else) is the token endpoint having a bad day.
 *
 * The returned message keeps Google's `error` / `error_description` and drops the rest of
 * the JSON envelope: it is shown to the owner in Discord and on the dashboard, and the
 * response body carries no secret of ours (the client secret is only ever sent, never
 * echoed back).
 */
export function tokenRefreshError(status: number, body: string): YoutubeApiError {
  const parsed = parseOauthError(body);
  const detail = parsed
    ? `${parsed.error}${parsed.description ? `: ${parsed.description}` : ""}`
    : body.slice(0, 200).trim();
  const permanent =
    parsed !== null &&
    ["invalid_grant", "invalid_client", "unauthorized_client"].includes(parsed.error);
  return new YoutubeApiError(
    permanent ? "auth" : "api",
    `YouTube OAuth token refresh failed (${status}${detail ? ` ${detail}` : ""})`,
    { status },
  );
}

function parseOauthError(body: string): { error: string; description?: string } | null {
  try {
    const json = JSON.parse(body) as { error?: unknown; error_description?: unknown };
    if (typeof json.error !== "string") return null;
    return {
      error: json.error,
      ...(typeof json.error_description === "string"
        ? { description: json.error_description }
        : {}),
    };
  } catch {
    return null;
  }
}

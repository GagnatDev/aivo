import OpenAI from "openai";

/**
 * A tiny error taxonomy for the boundaries where failure information exists and would
 * otherwise be flattened into a single generic string. Each class is thrown at the seam
 * that knows *why* something failed, so callers (and tests) can switch on the cause —
 * to pick a user-facing message, decide a retry policy, or assert behaviour — instead
 * of parsing log strings. This is deliberately not a framework: three small classes.
 */

/**
 * Why an LLM provider call failed, as far as the SDK error tells us:
 * - `auth`: bad/expired key or forbidden (permanent — the owner must act).
 * - `rate_limit`: throttled (transient — retryable after a wait).
 * - `server`: the provider errored (5xx, or an unclassified request failure).
 * - `network`: never reached the provider (connection/timeout).
 * - `aborted`: we cancelled the call ourselves (shutdown) — not a failure, and never
 *   retried; the caller decides what to do with a turn it just abandoned.
 */
export type LlmErrorKind = "auth" | "rate_limit" | "server" | "network" | "aborted";

/** A failed LLM provider call, tagged with the classified {@link LlmErrorKind}. */
export class LlmProviderError extends Error {
  readonly kind: LlmErrorKind;
  /** How long the provider asked us to wait before retrying (from `Retry-After`), if it said. */
  readonly retryAfterMs?: number;

  constructor(
    kind: LlmErrorKind,
    message: string,
    options?: { cause?: unknown; retryAfterMs?: number },
  ) {
    super(message, options ? { cause: options.cause } : undefined);
    this.name = "LlmProviderError";
    this.kind = kind;
    if (options?.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

/** A tool's `execute` threw. Carries the tool name; the cause is the original error. */
export class ToolExecutionError extends Error {
  readonly tool: string;

  constructor(tool: string, options?: { cause?: unknown }) {
    super(`The ${tool} tool failed to run`, options);
    this.name = "ToolExecutionError";
    this.tool = tool;
  }
}

/** A required piece of configuration is missing or invalid (e.g. no model for a tier). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * The provider-requested retry delay from an error's response headers, in milliseconds.
 * OpenAI-compatible servers send `retry-after-ms` (already ms) and/or `retry-after`
 * (whole seconds). The HTTP-date form of `Retry-After` is ignored — parsing it needs a
 * wall clock, and no OpenAI-compatible provider is known to send it.
 */
function retryAfterMsFrom(headers: Headers | undefined): number | undefined {
  // Headers.get returns null when absent, and Number(null) is 0 — so guard on the raw
  // string before coercing, or a missing header would read as "retry immediately".
  const ms = headers?.get("retry-after-ms");
  if (ms && Number.isFinite(Number(ms)) && Number(ms) >= 0) return Number(ms);
  const secs = headers?.get("retry-after");
  if (secs && Number.isFinite(Number(secs)) && Number(secs) >= 0) return Number(secs) * 1000;
  return undefined;
}

/**
 * Map an error thrown by the OpenAI SDK to an {@link LlmProviderError}. This is the one
 * place that understands the SDK's error shapes; everything downstream reasons over
 * `kind`. Non-SDK/unknown errors are treated as `server` (the safest "the provider side
 * broke" default) so no failure escapes the taxonomy.
 */
export function toLlmProviderError(err: unknown): LlmProviderError {
  // We aborted the request. Matched first: the SDK's abort error extends APIError (and a
  // raw fetch abort is a DOMException named AbortError), so without this it would be
  // classified as a `server` failure and retried — burning the shutdown window on calls
  // whose signal is already aborted.
  if (
    err instanceof OpenAI.APIUserAbortError ||
    (err instanceof Error && err.name === "AbortError")
  ) {
    return new LlmProviderError("aborted", "LLM call aborted", { cause: err });
  }
  // A connection error never reached the provider — and it also extends APIError with a
  // `null` status, so it must be matched before the status-based checks below.
  if (err instanceof OpenAI.APIConnectionError) {
    return new LlmProviderError("network", "could not reach the LLM provider", { cause: err });
  }
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    if (status === 401 || status === 403) {
      return new LlmProviderError("auth", `LLM provider auth failed (${status})`, { cause: err });
    }
    // Carry the provider's requested wait (if any) so the retry policy can honor it
    // instead of guessing — servers send Retry-After on 429 and sometimes 503.
    const retryAfterMs = retryAfterMsFrom(err.headers);
    if (status === 429) {
      return new LlmProviderError("rate_limit", "LLM provider rate limited (429)", {
        cause: err,
        retryAfterMs,
      });
    }
    return new LlmProviderError("server", `LLM provider error (${status ?? "unknown"})`, {
      cause: err,
      retryAfterMs,
    });
  }
  return new LlmProviderError("server", "unexpected LLM provider failure", { cause: err });
}

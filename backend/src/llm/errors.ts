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
 */
export type LlmErrorKind = "auth" | "rate_limit" | "server" | "network";

/** A failed LLM provider call, tagged with the classified {@link LlmErrorKind}. */
export class LlmProviderError extends Error {
  readonly kind: LlmErrorKind;

  constructor(kind: LlmErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmProviderError";
    this.kind = kind;
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
 * Map an error thrown by the OpenAI SDK to an {@link LlmProviderError}. This is the one
 * place that understands the SDK's error shapes; everything downstream reasons over
 * `kind`. Non-SDK/unknown errors are treated as `server` (the safest "the provider side
 * broke" default) so no failure escapes the taxonomy.
 */
export function toLlmProviderError(err: unknown): LlmProviderError {
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
    if (status === 429) {
      return new LlmProviderError("rate_limit", "LLM provider rate limited (429)", { cause: err });
    }
    return new LlmProviderError("server", `LLM provider error (${status ?? "unknown"})`, {
      cause: err,
    });
  }
  return new LlmProviderError("server", "unexpected LLM provider failure", { cause: err });
}

import { logger } from "../logger.js";
import { LlmProviderError } from "./errors.js";

/**
 * Retry policy for LLM provider calls, keyed on the error taxonomy in errors.ts:
 * transient kinds (`rate_limit`, `server`, `network`) are retried with full-jitter
 * exponential backoff; `auth` is permanent and fails fast. The SDK's own implicit
 * policy (2 silent retries, 10-minute timeout) is disabled in openaiProvider.ts so
 * this module is the only retry decision-maker.
 */

export interface RetryOptions {
  /** Retries after the first attempt (0 = fail on first error). */
  maxRetries: number;
  /** Backoff base for attempt 0; doubles each retry. */
  baseDelayMs?: number;
  /** Ceiling on any single wait, including a provider-sent Retry-After. */
  maxDelayMs?: number;
  /** Injectable for tests; defaults to a real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source in [0, 1); defaults to Math.random. */
  random?: () => number;
}

const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10_000;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether a failure is worth retrying at all (transient per the taxonomy). */
export function isRetryableLlmError(err: unknown): boolean {
  return (
    err instanceof LlmProviderError &&
    (err.kind === "rate_limit" || err.kind === "server" || err.kind === "network")
  );
}

/**
 * Run `fn`, retrying transient {@link LlmProviderError}s up to `maxRetries` times.
 * Each wait is full-jitter exponential backoff (`random() * min(cap, base * 2^attempt)`),
 * except that a provider-sent `Retry-After` sets the floor — the provider knows its own
 * rate window better than our guess — while `maxDelayMs` stays the hard ceiling so a
 * hostile/huge Retry-After can never hang a chat turn. Auth errors and non-taxonomy
 * errors propagate immediately.
 */
export async function withLlmRetries<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const base = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const cap = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = opts.sleep ?? realSleep;
  const random = opts.random ?? Math.random;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.maxRetries || !isRetryableLlmError(err)) throw err;
      const jittered = random() * Math.min(cap, base * 2 ** attempt);
      const retryAfterMs = err instanceof LlmProviderError ? err.retryAfterMs : undefined;
      const delayMs = Math.round(Math.min(cap, Math.max(retryAfterMs ?? 0, jittered)));
      logger.warn(
        {
          kind: err instanceof LlmProviderError ? err.kind : "unknown",
          attempt: attempt + 1,
          maxRetries: opts.maxRetries,
          delayMs,
          retryAfterMs,
        },
        "transient llm failure; retrying",
      );
      await sleep(delayMs);
    }
  }
}

import { describe, expect, it } from "vitest";
import { LlmProviderError } from "./errors.js";
import { isRetryableLlmError, withLlmRetries } from "./retry.js";

/** A scripted async fn that fails with `errors` in order, then returns "ok". */
function failThenSucceed(errors: unknown[]): { fn: () => Promise<string>; calls: () => number } {
  let calls = 0;
  return {
    fn: async () => {
      calls++;
      const err = errors.shift();
      if (err) throw err;
      return "ok";
    },
    calls: () => calls,
  };
}

/** A fake sleep that records each requested delay and resolves immediately. */
function fakeSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    delays,
  };
}

describe("isRetryableLlmError", () => {
  it("marks rate_limit/server/network as retryable, auth and unknown errors as not", () => {
    expect(isRetryableLlmError(new LlmProviderError("rate_limit", "429"))).toBe(true);
    expect(isRetryableLlmError(new LlmProviderError("server", "500"))).toBe(true);
    expect(isRetryableLlmError(new LlmProviderError("network", "offline"))).toBe(true);
    expect(isRetryableLlmError(new LlmProviderError("auth", "401"))).toBe(false);
    expect(isRetryableLlmError(new Error("plain"))).toBe(false);
  });
});

describe("withLlmRetries", () => {
  it("retries a transient failure and returns the eventual success", async () => {
    const { sleep, delays } = fakeSleep();
    const { fn, calls } = failThenSucceed([new LlmProviderError("server", "boom")]);

    const result = await withLlmRetries(fn, { maxRetries: 2, sleep, random: () => 0.5 });

    expect(result).toBe("ok");
    expect(calls()).toBe(2);
    expect(delays).toHaveLength(1);
  });

  it("fails fast on auth without retrying", async () => {
    const { sleep, delays } = fakeSleep();
    const { fn, calls } = failThenSucceed([new LlmProviderError("auth", "bad key")]);

    await expect(withLlmRetries(fn, { maxRetries: 5, sleep })).rejects.toMatchObject({
      kind: "auth",
    });
    expect(calls()).toBe(1);
    expect(delays).toHaveLength(0);
  });

  it("gives up after maxRetries and rethrows the last error", async () => {
    const { sleep, delays } = fakeSleep();
    const { fn, calls } = failThenSucceed([
      new LlmProviderError("network", "1"),
      new LlmProviderError("network", "2"),
      new LlmProviderError("network", "3"),
    ]);

    await expect(
      withLlmRetries(fn, { maxRetries: 2, sleep, random: () => 0.5 }),
    ).rejects.toMatchObject({ kind: "network", message: "3" });
    expect(calls()).toBe(3); // first attempt + 2 retries
    expect(delays).toHaveLength(2);
  });

  it("backs off exponentially with the injected jitter", async () => {
    const { sleep, delays } = fakeSleep();
    const { fn } = failThenSucceed([
      new LlmProviderError("server", "1"),
      new LlmProviderError("server", "2"),
    ]);

    await withLlmRetries(fn, { maxRetries: 2, baseDelayMs: 100, sleep, random: () => 1 });

    expect(delays).toEqual([100, 200]); // base * 2^attempt at full jitter
  });

  it("uses a provider-sent Retry-After as the delay floor", async () => {
    const { sleep, delays } = fakeSleep();
    const { fn } = failThenSucceed([
      new LlmProviderError("rate_limit", "429", { retryAfterMs: 3000 }),
    ]);

    await withLlmRetries(fn, { maxRetries: 1, baseDelayMs: 100, sleep, random: () => 0.1 });

    expect(delays).toEqual([3000]); // jittered backoff would be 10ms; Retry-After wins
  });

  it("caps even a provider-sent Retry-After at maxDelayMs", async () => {
    const { sleep, delays } = fakeSleep();
    const { fn } = failThenSucceed([
      new LlmProviderError("rate_limit", "429", { retryAfterMs: 120_000 }),
    ]);

    await withLlmRetries(fn, { maxRetries: 1, maxDelayMs: 5000, sleep, random: () => 0.5 });

    expect(delays).toEqual([5000]);
  });

  it("does not retry non-taxonomy errors", async () => {
    const { sleep } = fakeSleep();
    const { fn, calls } = failThenSucceed([new Error("not an llm error")]);

    await expect(withLlmRetries(fn, { maxRetries: 3, sleep })).rejects.toThrow("not an llm error");
    expect(calls()).toBe(1);
  });
});

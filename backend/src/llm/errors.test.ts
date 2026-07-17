import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { LlmProviderError, toLlmProviderError } from "./errors.js";

describe("toLlmProviderError", () => {
  it("maps 401/403 to auth", () => {
    for (const status of [401, 403]) {
      const mapped = toLlmProviderError(
        new OpenAI.APIError(status, undefined, "nope", new Headers()),
      );
      expect(mapped).toBeInstanceOf(LlmProviderError);
      expect(mapped.kind).toBe("auth");
    }
  });

  it("maps 429 to rate_limit", () => {
    const mapped = toLlmProviderError(
      new OpenAI.RateLimitError(429, undefined, "slow", new Headers()),
    );
    expect(mapped.kind).toBe("rate_limit");
  });

  it("maps 5xx to server", () => {
    const mapped = toLlmProviderError(
      new OpenAI.InternalServerError(500, undefined, "boom", new Headers()),
    );
    expect(mapped.kind).toBe("server");
  });

  it("maps a connection failure to network", () => {
    const mapped = toLlmProviderError(new OpenAI.APIConnectionError({ message: "offline" }));
    expect(mapped.kind).toBe("network");
  });

  it("maps other 4xx to server", () => {
    const mapped = toLlmProviderError(
      new OpenAI.BadRequestError(400, undefined, "bad", new Headers()),
    );
    expect(mapped.kind).toBe("server");
  });

  it("maps an unknown non-SDK error to server and keeps the cause", () => {
    const cause = new Error("weird");
    const mapped = toLlmProviderError(cause);
    expect(mapped.kind).toBe("server");
    expect(mapped.cause).toBe(cause);
  });

  it("carries retry-after seconds as retryAfterMs on 429", () => {
    const mapped = toLlmProviderError(
      new OpenAI.RateLimitError(429, undefined, "slow", new Headers({ "retry-after": "7" })),
    );
    expect(mapped.retryAfterMs).toBe(7000);
  });

  it("prefers the millisecond retry-after-ms header when both are present", () => {
    const mapped = toLlmProviderError(
      new OpenAI.RateLimitError(
        429,
        undefined,
        "slow",
        new Headers({ "retry-after-ms": "1500", "retry-after": "7" }),
      ),
    );
    expect(mapped.retryAfterMs).toBe(1500);
  });

  it("carries retry-after on 5xx and omits it when absent or unparseable", () => {
    const withHeader = toLlmProviderError(
      new OpenAI.InternalServerError(503, undefined, "busy", new Headers({ "retry-after": "2" })),
    );
    expect(withHeader.retryAfterMs).toBe(2000);
    const without = toLlmProviderError(
      new OpenAI.RateLimitError(429, undefined, "slow", new Headers()),
    );
    expect(without.retryAfterMs).toBeUndefined();
    // The HTTP-date form needs a wall clock, so it is deliberately not parsed.
    const httpDate = toLlmProviderError(
      new OpenAI.RateLimitError(
        429,
        undefined,
        "slow",
        new Headers({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }),
      ),
    );
    expect(httpDate.retryAfterMs).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { LlmProviderError } from "../llm/errors.js";
import { tokenRefreshError, YoutubeApiError } from "../youtube/errors.js";
import { classifyDigestFailure } from "./failure.js";

describe("classifyDigestFailure", () => {
  it("maps a dead refresh token to youtube_auth, keeping Google's reason", () => {
    const failure = classifyDigestFailure(
      tokenRefreshError(
        400,
        '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}',
      ),
    );
    expect(failure.kind).toBe("youtube_auth");
    expect(failure.message).toContain("invalid_grant");
  });

  it("maps a Data API error to youtube_api", () => {
    const err = new YoutubeApiError("api", "YouTube API subscriptions failed: 403 quotaExceeded");
    expect(classifyDigestFailure(err).kind).toBe("youtube_api");
  });

  it("maps a provider failure to llm", () => {
    const failure = classifyDigestFailure(new LlmProviderError("server", "gateway exploded"));
    expect(failure).toEqual({ kind: "llm", message: "gateway exploded" });
  });

  it("falls back to unknown for anything else", () => {
    expect(classifyDigestFailure(new Error("boom"))).toEqual({ kind: "unknown", message: "boom" });
    expect(classifyDigestFailure("plain string")).toEqual({
      kind: "unknown",
      message: "plain string",
    });
    expect(classifyDigestFailure(undefined)).toEqual({ kind: "unknown", message: "unknown error" });
    expect(classifyDigestFailure(new Error("   "))).toEqual({
      kind: "unknown",
      message: "unknown error",
    });
  });

  it("truncates a message too long to render", () => {
    const failure = classifyDigestFailure(new Error("x".repeat(1000)));
    expect(failure.message).toHaveLength(300);
    expect(failure.message.endsWith("…")).toBe(true);
  });
});

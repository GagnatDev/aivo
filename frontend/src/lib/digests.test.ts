import { describe, expect, it } from "vitest";
import {
  describeFailure,
  DIGEST_STATUS_META,
  formatConfidence,
  formatDuration,
  needsReconnect,
  type DigestRunSummary,
  type YoutubeStatus,
} from "./digests.js";

describe("formatDuration", () => {
  it("formats minutes and hours, zero-padding inside the stamp", () => {
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(600)).toBe("10:00");
    expect(formatDuration(3723)).toBe("1:02:03");
  });

  it("passes through unknown durations", () => {
    expect(formatDuration(null)).toBeNull();
  });
});

describe("describeFailure", () => {
  it("leads with the reconnect headline for an expired YouTube grant, keeping the detail", () => {
    const described = describeFailure({
      kind: "youtube_auth",
      message: "YouTube OAuth token refresh failed (400 invalid_grant)",
    });
    expect(described).toMatch(/^YouTube access expired — reconnect/);
    expect(described).toMatch(/invalid_grant/);
  });

  it("describes the other kinds as retryable", () => {
    expect(describeFailure({ kind: "llm", message: "gateway exploded" })).toMatch(
      /model provider call failed/,
    );
    expect(describeFailure({ kind: "youtube_api", message: "" })).toBe(
      "The YouTube API call failed — the next scheduled run retries",
    );
  });

  it("renders nothing for a run that did not fail", () => {
    expect(describeFailure(null)).toBeNull();
  });
});

describe("needsReconnect", () => {
  const connected: YoutubeStatus = {
    connected: true,
    title: "Ann-Katrin",
    subscriptionsSyncedAt: null,
    videosPolledAt: null,
    oauthStartPath: "/youtube/oauth/start",
    refreshTokenSecretKey: "YOUTUBE_OAUTH_REFRESH_TOKEN",
  };
  const run = (overrides: Partial<DigestRunSummary> = {}): DigestRunSummary => ({
    id: "r1",
    runDate: "2026-07-01",
    status: "delivered",
    coversSince: "2026-06-30T05:00:00Z",
    deliveredAt: "2026-07-01T05:01:00Z",
    createdAt: "2026-07-01T05:00:00Z",
    cost: { cents: 1, formatted: "1¢" },
    failure: null,
    pickCount: 1,
    rejectCount: 0,
    ...overrides,
  });

  it("is true when YouTube was never connected", () => {
    expect(needsReconnect([], { ...connected, connected: false })).toBe(true);
  });

  it("is true when the newest run died on an expired grant", () => {
    const failed = run({
      status: "failed",
      deliveredAt: null,
      failure: { kind: "youtube_auth", message: "invalid_grant" },
    });
    expect(needsReconnect([failed, run()], connected)).toBe(true);
  });

  it("is false once a later run succeeded, or for other failure kinds", () => {
    const failed = run({
      id: "r0",
      status: "failed",
      failure: { kind: "youtube_auth", message: "invalid_grant" },
    });
    expect(needsReconnect([run(), failed], connected)).toBe(false);
    expect(
      needsReconnect(
        [run({ status: "failed", failure: { kind: "llm", message: "boom" } })],
        connected,
      ),
    ).toBe(false);
    expect(needsReconnect([], connected)).toBe(false);
  });
});

describe("DIGEST_STATUS_META", () => {
  it("gives a failed run its own chip, never color alone", () => {
    expect(DIGEST_STATUS_META.failed).toEqual({ label: "Failed", color: "#d03b3b", icon: "✕" });
  });
});

describe("formatConfidence", () => {
  it("renders a 0..1 confidence as a whole percent", () => {
    expect(formatConfidence(0.87)).toBe("87%");
    expect(formatConfidence(1)).toBe("100%");
  });

  it("passes through missing confidence", () => {
    expect(formatConfidence(null)).toBeNull();
  });
});

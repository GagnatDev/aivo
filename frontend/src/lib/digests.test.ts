import { describe, expect, it } from "vitest";
import {
  describeFailure,
  DIGEST_STATUS_META,
  formatConfidence,
  formatDuration,
  formatReleaseAt,
  needsReconnect,
  partitionDigestItems,
  releaseAt,
  type DigestItem,
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

describe("partitionDigestItems", () => {
  const NOW = new Date("2026-08-05T06:00:00Z");
  const item = (
    id: string,
    publishedAt: string,
    rank: number,
    scheduledStartTime: string | null = null,
  ): DigestItem => ({
    id,
    rank,
    confidence: 0.8,
    reason: null,
    video: {
      id,
      title: `Title ${id}`,
      channelTitle: "Chan",
      durationSeconds: 600,
      publishedAt,
      scheduledStartTime,
      thumbnailUrl: null,
      summary: null,
      why: null,
    },
  });

  it("keeps released order and sorts upcoming earliest-first", () => {
    const { released, upcoming } = partitionDigestItems(
      [
        item("a", "2026-08-04T10:00:00Z", 1),
        item("b", "2026-08-07T18:00:00Z", 2),
        item("c", "2026-08-06T12:00:00Z", 3),
      ],
      NOW,
    );
    expect(released.map((i) => i.id)).toEqual(["a"]);
    expect(upcoming.map((i) => i.id)).toEqual(["c", "b"]);
  });

  it("groups premieres by their air time, not their publish instant", () => {
    // All three were published before NOW; only the premiere schedule says two of them
    // aren't out yet (see backend digest/present.ts).
    const { released, upcoming } = partitionDigestItems(
      [
        item("out", "2026-08-04T10:00:00Z", 1),
        item("late", "2026-08-04T08:00:00Z", 2, "2026-08-08T18:00:00Z"),
        item("soon", "2026-08-03T08:00:00Z", 3, "2026-08-05T18:00:00Z"),
        item("aired", "2026-08-01T08:00:00Z", 4, "2026-08-02T18:00:00Z"),
      ],
      NOW,
    );
    expect(released.map((i) => i.id)).toEqual(["out", "aired"]);
    expect(upcoming.map((i) => i.id)).toEqual(["soon", "late"]);
  });
});

describe("releaseAt", () => {
  it("is the publish instant without a premiere schedule", () => {
    expect(releaseAt({ publishedAt: "2026-08-04T10:00:00Z", scheduledStartTime: null })).toBe(
      new Date("2026-08-04T10:00:00Z").getTime(),
    );
  });

  it("is the air time of an already-published premiere", () => {
    expect(
      releaseAt({
        publishedAt: "2026-08-04T10:00:00Z",
        scheduledStartTime: "2026-08-06T16:00:00Z",
      }),
    ).toBe(new Date("2026-08-06T16:00:00Z").getTime());
  });
});

describe("formatReleaseAt", () => {
  it("renders weekday, date, and time", () => {
    // Fixed UTC so the assertion doesn't depend on the runner's local zone.
    const text = formatReleaseAt("2026-08-06T16:00:00Z", "UTC");
    expect(text).toMatch(/Thursday/i);
    expect(text).toMatch(/6/);
    expect(text).toMatch(/Aug/i);
    expect(text).toMatch(/16:00/);
  });
});

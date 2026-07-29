import { describe, expect, it } from "vitest";
import {
  describeFailure,
  DIGEST_STATUS_META,
  formatConfidence,
  formatDuration,
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

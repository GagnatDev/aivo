import { describe, expect, it } from "vitest";
import { formatConfidence, formatDuration } from "./digests.js";

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

describe("formatConfidence", () => {
  it("renders a 0..1 confidence as a whole percent", () => {
    expect(formatConfidence(0.87)).toBe("87%");
    expect(formatConfidence(1)).toBe("100%");
  });

  it("passes through missing confidence", () => {
    expect(formatConfidence(null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { DeliverablePick } from "./pipeline.js";
import { formatReleaseAt, isUpcoming, partitionPicks } from "./present.js";

const pick = (id: string, publishedAt: string, rank: number): DeliverablePick => ({
  itemId: `item-${id}`,
  videoId: id,
  title: `Title ${id}`,
  channelTitle: "Chan",
  url: `https://www.youtube.com/watch?v=${id}`,
  durationSeconds: 600,
  thumbnailUrl: null,
  summaryBullets: [],
  why: "",
  rank,
  publishedAt: new Date(publishedAt),
});

const NOW = new Date("2026-08-05T06:00:00Z");

describe("isUpcoming", () => {
  it("treats publishedAt strictly after now as upcoming", () => {
    expect(isUpcoming(new Date("2026-08-05T06:00:01Z"), NOW)).toBe(true);
    expect(isUpcoming(new Date("2026-08-05T06:00:00Z"), NOW)).toBe(false);
    expect(isUpcoming(new Date("2026-08-04T12:00:00Z"), NOW)).toBe(false);
  });
});

describe("partitionPicks", () => {
  it("keeps released confidence order and sorts upcoming earliest-first", () => {
    const picks = [
      pick("a", "2026-08-04T10:00:00Z", 1), // released
      pick("b", "2026-08-07T18:00:00Z", 2), // upcoming later
      pick("c", "2026-08-06T12:00:00Z", 3), // upcoming sooner
      pick("d", "2026-08-03T09:00:00Z", 4), // released
    ];
    const { released, upcoming } = partitionPicks(picks, NOW);
    expect(released.map((p) => p.videoId)).toEqual(["a", "d"]);
    expect(upcoming.map((p) => p.videoId)).toEqual(["c", "b"]);
  });

  it("returns empty buckets when there are no picks", () => {
    expect(partitionPicks([], NOW)).toEqual({ released: [], upcoming: [] });
  });
});

describe("formatReleaseAt", () => {
  // 16:00Z = 18:00 Europe/Oslo in August (UTC+2).
  const at = new Date("2026-08-06T16:00:00Z");

  it("renders weekday, date, and local time in English", () => {
    const text = formatReleaseAt(at, "Europe/Oslo", "en");
    expect(text).toMatch(/Thursday/i);
    expect(text).toMatch(/6/);
    expect(text).toMatch(/Aug/i);
    expect(text).toMatch(/18:00/);
  });

  it("renders weekday names in Norwegian", () => {
    const text = formatReleaseAt(at, "Europe/Oslo", "nb");
    expect(text.toLowerCase()).toMatch(/torsdag/);
    expect(text).toMatch(/18:00/);
  });

  it("falls back to UTC on an invalid timezone", () => {
    const text = formatReleaseAt(at, "Not/AZone", "en");
    expect(text).toMatch(/16:00/);
  });
});

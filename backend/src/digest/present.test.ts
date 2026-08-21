import { describe, expect, it } from "vitest";
import type { DeliverablePick } from "./pipeline.js";
import { formatReleaseAt, isUpcoming, partitionPicks, releaseAt } from "./present.js";

const pick = (
  id: string,
  publishedAt: string,
  rank: number,
  scheduledStartTime: string | null = null,
): DeliverablePick => ({
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
  scheduledStartTime: scheduledStartTime ? new Date(scheduledStartTime) : null,
});

const NOW = new Date("2026-08-05T06:00:00Z");

describe("releaseAt", () => {
  it("is the publish instant for an ordinary upload", () => {
    const at = new Date("2026-08-04T10:00:00Z");
    expect(releaseAt({ publishedAt: at, scheduledStartTime: null })).toEqual(at);
  });

  it("is the premiere time even though the placeholder was published earlier", () => {
    // How YouTube reports an announced premiere: the uploads playlist carries it the
    // moment it is announced, so publishedAt is already in the past.
    const scheduled = new Date("2026-08-07T18:00:00Z");
    expect(
      releaseAt({ publishedAt: new Date("2026-08-04T09:00:00Z"), scheduledStartTime: scheduled }),
    ).toEqual(scheduled);
  });

  it("keeps a future publish instant over an earlier scheduled start", () => {
    const published = new Date("2026-08-09T12:00:00Z");
    expect(
      releaseAt({ publishedAt: published, scheduledStartTime: new Date("2026-08-01T12:00:00Z") }),
    ).toEqual(published);
  });
});

describe("isUpcoming", () => {
  it("treats a release instant strictly after now as upcoming", () => {
    const at = (iso: string) => ({ publishedAt: new Date(iso), scheduledStartTime: null });
    expect(isUpcoming(at("2026-08-05T06:00:01Z"), NOW)).toBe(true);
    expect(isUpcoming(at("2026-08-05T06:00:00Z"), NOW)).toBe(false);
    expect(isUpcoming(at("2026-08-04T12:00:00Z"), NOW)).toBe(false);
  });

  it("treats an already-published premiere that hasn't started as upcoming", () => {
    expect(
      isUpcoming(
        {
          publishedAt: new Date("2026-08-04T09:00:00Z"),
          scheduledStartTime: new Date("2026-08-06T16:00:00Z"),
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("treats a premiere that has already started as released", () => {
    expect(
      isUpcoming(
        {
          publishedAt: new Date("2026-08-01T09:00:00Z"),
          scheduledStartTime: new Date("2026-08-04T16:00:00Z"),
        },
        NOW,
      ),
    ).toBe(false);
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

  it("groups premieres whose placeholder is already published, in premiere order", () => {
    // Every one of these was "published" before now — only the premiere schedule says
    // they aren't out yet. Before scheduledStartTime existed they all landed in
    // `released` and were listed among the watchable picks.
    const picks = [
      pick("out", "2026-08-04T10:00:00Z", 1),
      pick("late-premiere", "2026-08-04T08:00:00Z", 2, "2026-08-08T18:00:00Z"),
      pick("soon-premiere", "2026-08-03T08:00:00Z", 3, "2026-08-05T18:00:00Z"),
      pick("aired-premiere", "2026-08-01T08:00:00Z", 4, "2026-08-02T18:00:00Z"),
    ];
    const { released, upcoming } = partitionPicks(picks, NOW);
    expect(released.map((p) => p.videoId)).toEqual(["out", "aired-premiere"]);
    expect(upcoming.map((p) => p.videoId)).toEqual(["soon-premiere", "late-premiere"]);
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

import { describe, expect, it } from "vitest";
import {
  buildBurnDown,
  buildTokenMix,
  formatCentsTick,
  listUtcDays,
  MAX_GROUPS,
  OTHER_GROUP,
  pivotBuckets,
  rangeToWindow,
  type SeriesBucket,
} from "./usage.js";

function bucket(day: string, group: string | null, cents: number): SeriesBucket {
  return {
    day,
    group,
    cost: { cents, formatted: `${cents}¢` },
    calls: 1,
    tokensIn: 10,
    tokensOut: 5,
  };
}

describe("listUtcDays", () => {
  it("spans from-day through to-day inclusive, across month edges", () => {
    expect(listUtcDays(new Date("2026-06-29T15:00:00Z"), new Date("2026-07-02T01:00:00Z"))).toEqual(
      ["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"],
    );
  });
});

describe("buildBurnDown", () => {
  it("accumulates and carries the total across gap days", () => {
    const points = buildBurnDown(
      [bucket("2026-06-01", null, 2), bucket("2026-06-03", null, 3)],
      ["2026-06-01", "2026-06-02", "2026-06-03"],
    );
    expect(points.map((p) => p.cumulativeCents)).toEqual([2, 2, 5]);
  });
});

describe("pivotBuckets", () => {
  it("zero-fills days and keeps groups in alphabetical (identity) order", () => {
    const { rows, groups } = pivotBuckets(
      [bucket("2026-06-01", "premium-1", 5), bucket("2026-06-02", "cheap-1", 1)],
      ["2026-06-01", "2026-06-02"],
    );
    // Alphabetical despite premium having the larger spend — color follows the
    // entity, never its rank.
    expect(groups).toEqual(["cheap-1", "premium-1"]);
    expect(rows).toEqual([
      { day: "2026-06-01", "cheap-1": 0, "premium-1": 5 },
      { day: "2026-06-02", "cheap-1": 1, "premium-1": 0 },
    ]);
  });

  it("folds the smallest groups into Other beyond the palette's fixed slots", () => {
    const buckets = Array.from({ length: MAX_GROUPS + 2 }, (_, i) =>
      bucket("2026-06-01", `model-${String(i).padStart(2, "0")}`, i + 1),
    );
    const { groups, rows } = pivotBuckets(buckets, ["2026-06-01"]);
    expect(groups).toHaveLength(MAX_GROUPS);
    expect(groups[groups.length - 1]).toBe(OTHER_GROUP);
    // model-00 (1¢) + model-01 (2¢) + model-02 (3¢) are the three smallest.
    expect(rows[0]![OTHER_GROUP]).toBe(6);
  });
});

describe("buildTokenMix", () => {
  it("sums grouped buckets per day and zero-fills gaps", () => {
    const points = buildTokenMix(
      [bucket("2026-06-01", "a", 1), bucket("2026-06-01", "b", 1)],
      ["2026-06-01", "2026-06-02"],
    );
    expect(points).toEqual([
      { day: "2026-06-01", tokensIn: 20, tokensOut: 10 },
      { day: "2026-06-02", tokensIn: 0, tokensOut: 0 },
    ]);
  });
});

describe("rangeToWindow", () => {
  it("mtd starts at the first of the UTC month", () => {
    const { from } = rangeToWindow("mtd", new Date("2026-07-03T10:00:00Z"));
    expect(from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("7d reaches back exactly seven days", () => {
    const now = new Date("2026-07-03T10:00:00Z");
    const { from } = rangeToWindow("7d", now);
    expect(from.toISOString()).toBe("2026-06-26T10:00:00.000Z");
  });
});

describe("formatCentsTick", () => {
  it("switches from cents to euros at one euro", () => {
    expect(formatCentsTick(45.5)).toBe("45.5¢");
    expect(formatCentsTick(100)).toBe("€1");
    expect(formatCentsTick(150)).toBe("€1.5");
  });
});

import { describe, expect, it } from "vitest";
import { buildShares, formatCacheHitRatio, formatPerMtok, type ModelsUsage } from "./models.js";

const money = (cents: number) => ({ cents, formatted: `${cents}¢` });

describe("buildShares", () => {
  it("computes each model's fraction of total spend, keeping spend order", () => {
    const usage: ModelsUsage = {
      since: "2026-06-01T00:00:00.000Z",
      models: [
        {
          model: "premium-1",
          cost: money(6),
          calls: 2,
          tokensIn: 10,
          tokensOut: 5,
          tokensCached: 0,
        },
        {
          model: "cheap-1",
          cost: money(2),
          calls: 8,
          tokensIn: 100,
          tokensOut: 50,
          tokensCached: 0,
        },
      ],
    };
    const shares = buildShares(usage);
    expect(shares.map((s) => s.model)).toEqual(["premium-1", "cheap-1"]);
    expect(shares[0]?.share).toBeCloseTo(0.75);
    expect(shares[1]?.share).toBeCloseTo(0.25);
  });

  it("assigns color slots by alphabetical identity, not spend rank", () => {
    const usage: ModelsUsage = {
      since: "2026-06-01T00:00:00.000Z",
      models: [
        { model: "zeta", cost: money(9), calls: 1, tokensIn: 1, tokensOut: 1, tokensCached: 0 },
        { model: "alpha", cost: money(1), calls: 1, tokensIn: 1, tokensOut: 1, tokensCached: 0 },
      ],
    };
    const shares = buildShares(usage);
    expect(shares.find((s) => s.model === "alpha")?.colorIndex).toBe(0);
    expect(shares.find((s) => s.model === "zeta")?.colorIndex).toBe(1);
  });

  it("reports each model's prompt-cache hit ratio over its input tokens", () => {
    const usage: ModelsUsage = {
      since: "2026-06-01T00:00:00.000Z",
      models: [
        {
          model: "cached",
          cost: money(1),
          calls: 1,
          tokensIn: 1000,
          tokensOut: 1,
          tokensCached: 750,
        },
        { model: "audio", cost: money(1), calls: 1, tokensIn: 0, tokensOut: 0, tokensCached: 0 },
      ],
    };
    const shares = buildShares(usage);
    expect(shares[0]?.cacheHitRatio).toBeCloseTo(0.75);
    expect(shares[1]?.cacheHitRatio).toBeNull();
  });

  it("keeps a zero hit rate distinct from a model that sent no input", () => {
    const usage: ModelsUsage = {
      since: "2026-06-01T00:00:00.000Z",
      models: [
        { model: "cold", cost: money(1), calls: 1, tokensIn: 1000, tokensOut: 1, tokensCached: 0 },
      ],
    };
    expect(buildShares(usage)[0]?.cacheHitRatio).toBe(0);
    expect(formatCacheHitRatio(0)).toBe(" · 0% cached");
    expect(formatCacheHitRatio(0.75)).toBe(" · 75% cached");
    expect(formatCacheHitRatio(null)).toBe("");
  });

  it("yields zero shares when there is no spend", () => {
    const usage: ModelsUsage = {
      since: "2026-06-01T00:00:00.000Z",
      models: [
        { model: "cheap-1", cost: money(0), calls: 3, tokensIn: 1, tokensOut: 1, tokensCached: 0 },
      ],
    };
    expect(buildShares(usage)[0]?.share).toBe(0);
  });
});

describe("formatPerMtok", () => {
  it("keeps sub-euro prices in cents without numeric noise", () => {
    expect(formatPerMtok(20)).toBe("20¢");
    expect(formatPerMtok(12.5)).toBe("12.5¢");
  });

  it("switches to euros at 100 cents", () => {
    expect(formatPerMtok(150)).toBe("€1.5");
  });
});

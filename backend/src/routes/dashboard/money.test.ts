import { describe, expect, it } from "vitest";
import { formatCents, money } from "./money.js";

describe("formatCents", () => {
  it("keeps sub-euro amounts in cents without rounding sub-cent calls to zero", () => {
    expect(formatCents(0.0042)).toBe("0.0042¢");
    expect(formatCents(12.3)).toBe("12.3¢");
    expect(formatCents(0)).toBe("0¢");
  });

  it("formats a euro and up as euros with two decimals", () => {
    expect(formatCents(100)).toBe("€1.00");
    expect(formatCents(1500)).toBe("€15.00");
    expect(formatCents(123.456)).toBe("€1.23");
  });

  it("handles negative amounts (defensive; the ledger never goes negative)", () => {
    expect(formatCents(-250)).toBe("€-2.50");
  });
});

describe("money", () => {
  it("carries the exact cents value alongside the formatted string", () => {
    expect(money(0.0042)).toEqual({ cents: 0.0042, formatted: "0.0042¢" });
  });
});

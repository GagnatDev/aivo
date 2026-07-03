import { describe, expect, it } from "vitest";
import { rejectedListLimit } from "./taper.js";

describe("rejectedListLimit", () => {
  it("shows the full list while calibrating (few samples or low agreement)", () => {
    expect(rejectedListLimit({ samples: 0, rate: 0 })).toBe(5);
    expect(rejectedListLimit({ samples: 10, rate: 1 })).toBe(5);
    expect(rejectedListLimit({ samples: 40, rate: 0.7 })).toBe(5);
  });

  it("tapers to borderline calls as agreement rises", () => {
    expect(rejectedListLimit({ samples: 40, rate: 0.9 })).toBe(2);
  });

  it("disappears once agreement is high", () => {
    expect(rejectedListLimit({ samples: 40, rate: 0.97 })).toBe(0);
  });
});

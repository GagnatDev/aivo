import { describe, expect, it } from "vitest";
import { parseIso8601Duration, uploadsPlaylistId } from "./api.js";

describe("parseIso8601Duration", () => {
  it("parses hours/minutes/seconds", () => {
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3723);
    expect(parseIso8601Duration("PT15M")).toBe(900);
    expect(parseIso8601Duration("PT45S")).toBe(45);
    expect(parseIso8601Duration("P1DT1S")).toBe(86_401);
  });

  it("returns null for missing or degenerate input", () => {
    expect(parseIso8601Duration(undefined)).toBeNull();
    expect(parseIso8601Duration("P0D")).toBeNull(); // live streams
    expect(parseIso8601Duration("garbage")).toBeNull();
  });
});

describe("uploadsPlaylistId", () => {
  it("maps a UC channel id to its UU uploads playlist", () => {
    expect(uploadsPlaylistId("UCabc123")).toBe("UUabc123");
  });

  it("passes through non-UC ids unchanged", () => {
    expect(uploadsPlaylistId("HCxyz")).toBe("HCxyz");
  });
});

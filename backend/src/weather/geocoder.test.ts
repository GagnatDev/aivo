import { describe, expect, it } from "vitest";
import { parseGeocode } from "./geocoder.js";

describe("parseGeocode", () => {
  it("returns the first hit with numeric coordinates", () => {
    const result = parseGeocode([
      { lat: "63.4305", lon: "10.3951", display_name: "Trondheim, Trøndelag, Norway" },
      { lat: "1.0", lon: "2.0", display_name: "somewhere else" },
    ]);
    expect(result).toEqual({
      name: "Trondheim, Trøndelag, Norway",
      latitude: 63.4305,
      longitude: 10.3951,
    });
  });

  it("returns null for no matches or unparsable coordinates", () => {
    expect(parseGeocode([])).toBeNull();
    expect(parseGeocode("not an array")).toBeNull();
    expect(parseGeocode([{ lat: "abc", lon: "10.0", display_name: "x" }])).toBeNull();
  });
});

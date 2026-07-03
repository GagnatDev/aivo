import { describe, expect, it } from "vitest";
import { buildLoginUrl } from "./auth.js";

describe("buildLoginUrl", () => {
  it("round-trips a relative path", () => {
    expect(buildLoginUrl("/usage?range=7d")).toBe("/auth/login?next=%2Fusage%3Frange%3D7d");
  });

  it("refuses absolute and protocol-relative URLs (open-redirect guard)", () => {
    expect(buildLoginUrl("https://evil.example")).toBe("/auth/login?next=%2F");
    expect(buildLoginUrl("//evil.example")).toBe("/auth/login?next=%2F");
  });
});

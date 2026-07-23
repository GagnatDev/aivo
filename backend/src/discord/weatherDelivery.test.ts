import { describe, expect, it } from "vitest";
import { NO_HOME_NUDGE, conversationSummary, weatherReportMessage } from "./weatherDelivery.js";

describe("weatherReportMessage", () => {
  it("sends the report text verbatim", () => {
    expect(
      weatherReportMessage({ kind: "report", locationName: "Oslo", text: "🌅 morning!" }),
    ).toBe("🌅 morning!");
  });

  it("nudges to set a home", () => {
    expect(weatherReportMessage({ kind: "no_home" })).toBe(NO_HOME_NUDGE);
  });

  it("reports a fetch failure honestly instead of confabulating", () => {
    const msg = weatherReportMessage({ kind: "error", message: "timeout" });
    expect(msg).toContain("couldn't put together");
    expect(msg).toContain("timeout");
  });
});

describe("conversationSummary", () => {
  it("summarizes each outcome for the audit row", () => {
    expect(conversationSummary({ kind: "report", locationName: "Oslo", text: "x" })).toContain(
      "Oslo",
    );
    expect(conversationSummary({ kind: "no_home" })).toContain("no home");
    expect(conversationSummary({ kind: "error", message: "boom" })).toContain("boom");
  });
});

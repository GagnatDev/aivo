import { describe, expect, it } from "vitest";
import { messages } from "../i18n/index.js";
import { conversationSummary, weatherReportMessage } from "./weatherDelivery.js";

describe("weatherReportMessage", () => {
  it("sends the report text verbatim", () => {
    expect(
      weatherReportMessage({ kind: "report", locationName: "Oslo", text: "🌅 morning!" }, "en"),
    ).toBe("🌅 morning!");
  });

  it("nudges to set a home", () => {
    expect(weatherReportMessage({ kind: "no_home" }, "en")).toBe(
      messages("en").weather.noHomeNudge,
    );
  });

  it("nudges to set a home in Norwegian", () => {
    expect(weatherReportMessage({ kind: "no_home" }, "nb")).toBe(
      messages("nb").weather.noHomeNudge,
    );
  });

  it("reports a fetch failure honestly instead of confabulating", () => {
    const msg = weatherReportMessage({ kind: "error", message: "timeout" }, "en");
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

import { describe, expect, it } from "vitest";
import { RepeatTracker, toolCallSignature } from "./repeatDetection.js";

describe("toolCallSignature", () => {
  it("is stable across key order and whitespace", () => {
    expect(toolCallSignature("reminder", '{"action":"list","limit":3}')).toBe(
      toolCallSignature("reminder", '{ "limit": 3,\n  "action": "list" }'),
    );
  });

  it("canonicalizes nested objects but keeps array order significant", () => {
    expect(toolCallSignature("t", '{"a":{"y":1,"x":2}}')).toBe(
      toolCallSignature("t", '{"a":{"x":2,"y":1}}'),
    );
    expect(toolCallSignature("t", '{"a":[1,2]}')).not.toBe(toolCallSignature("t", '{"a":[2,1]}'));
  });

  it("distinguishes tools and arguments, and falls back to the raw string", () => {
    expect(toolCallSignature("a", "{}")).not.toBe(toolCallSignature("b", "{}"));
    expect(toolCallSignature("t", '{"x":1}')).not.toBe(toolCallSignature("t", '{"x":2}'));
    // Unparseable arguments still get a stable identity (trimmed raw text).
    expect(toolCallSignature("t", ' {"x": ')).toBe(toolCallSignature("t", '{"x":'));
  });
});

describe("RepeatTracker", () => {
  it("flags a re-run that returned the same result", () => {
    const tracker = new RepeatTracker();
    expect(tracker.record("reminder", '{"action":"list"}', "no reminders")).toBe(false);
    expect(tracker.record("reminder", '{ "action" : "list" }', "no reminders")).toBe(true);
  });

  it("does not flag a re-read whose result changed (read-after-write)", () => {
    const tracker = new RepeatTracker();
    // list → cancel → list: the confirming read returns different data, so it counts as
    // progress rather than tripping the stuck-loop backstop.
    expect(tracker.record("reminder", '{"action":"list"}', "1. call mum")).toBe(false);
    expect(tracker.record("reminder", '{"action":"cancel","id":"r1"}', "Cancelled.")).toBe(false);
    expect(tracker.record("reminder", '{"action":"list"}', "no reminders")).toBe(false);
  });

  it("flags the next re-read once the result stops changing", () => {
    const tracker = new RepeatTracker();
    tracker.record("reminder", '{"action":"list"}', "1. call mum");
    tracker.record("reminder", '{"action":"list"}', "no reminders");
    expect(tracker.record("reminder", '{"action":"list"}', "no reminders")).toBe(true);
  });

  it("treats different calls as unrelated even with identical results", () => {
    const tracker = new RepeatTracker();
    expect(tracker.record("memory", '{"action":"search","term":"a"}', "[]")).toBe(false);
    expect(tracker.record("memory", '{"action":"search","term":"b"}', "[]")).toBe(false);
  });
});

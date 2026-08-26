import { describe, expect, it } from "vitest";
import {
  formatLatency,
  isDegradedOutcome,
  mergeThreadEntries,
  type ThreadMessage,
  type TurnSummary,
} from "./activity.js";

function message(id: string, createdAt: string): ThreadMessage {
  return {
    id,
    role: "user",
    content: id,
    toolCalls: null,
    toolName: null,
    createdAt,
    tokensIn: null,
    tokensOut: null,
  };
}

function turn(id: string, createdAt: string): TurnSummary {
  return {
    id,
    turnId: `t-${id}`,
    outcome: "final_answer",
    iterations: 1,
    toolsCalled: [],
    toolErrors: 0,
    tokensIn: 10,
    tokensOut: 5,
    costCents: 0.1,
    latencyMs: 900,
    finishReasons: ["stop"],
    createdAt,
  };
}

describe("mergeThreadEntries", () => {
  it("interleaves turn records with messages by timestamp, oldest first", () => {
    const entries = mergeThreadEntries(
      [message("m1", "2026-07-01T10:00:00.000Z"), message("m2", "2026-07-01T10:00:05.000Z")],
      [turn("s1", "2026-07-01T10:00:03.000Z")],
    );
    expect(entries.map((e) => (e.kind === "turn" ? e.turn.id : e.message.id))).toEqual([
      "m1",
      "s1",
      "m2",
    ]);
  });

  it("keeps a turn record after a message it shares a timestamp with", () => {
    // The record is written when the turn ends, so it belongs below its last message.
    const at = "2026-07-01T10:00:00.000Z";
    const entries = mergeThreadEntries([message("m1", at)], [turn("s1", at)]);
    expect(entries.map((e) => e.kind)).toEqual(["message", "turn"]);
  });

  it("passes messages through untouched when a thread has no turn records", () => {
    const entries = mergeThreadEntries([message("m1", "2026-07-01T10:00:00.000Z")], []);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("message");
  });
});

describe("formatLatency", () => {
  it("reads sub-second turns in milliseconds and longer ones in seconds", () => {
    expect(formatLatency(940)).toBe("940ms");
    expect(formatLatency(1000)).toBe("1.0s");
    expect(formatLatency(42_300)).toBe("42.3s");
  });
});

describe("isDegradedOutcome", () => {
  it("flags every outcome except a clean answer", () => {
    expect(isDegradedOutcome("final_answer")).toBe(false);
    expect(isDegradedOutcome("forced_answer")).toBe(true);
    expect(isDegradedOutcome("iteration_cap")).toBe(true);
    expect(isDegradedOutcome("cost_ceiling")).toBe(true);
    expect(isDegradedOutcome("provider_error")).toBe(true);
    expect(isDegradedOutcome("aborted")).toBe(true);
  });
});

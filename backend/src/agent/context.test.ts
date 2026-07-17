import { describe, expect, it } from "vitest";
import { buildContext, currentTimeLine } from "./context.js";
import { makeFakeLlm } from "../test/fakeLlm.js";
import { FakeClock, makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";

useCleanDb();

/** The injected "What you remember…" system block, or undefined if none. */
function memoryBlock(messages: { role: string; content: string | null }[]): string | undefined {
  return (
    messages.find((m) => m.role === "system" && m.content?.startsWith("What you remember"))
      ?.content ?? undefined
  );
}

describe("buildContext", () => {
  it("caps injected memories and lists pinned ones first", async () => {
    const deps = makeAgentDeps(makeFakeLlm([]));
    const { userId, conversationId } = await provisionUser(deps, OWNER_ID);

    // 25 memories, oldest-first. Pin the oldest so it would otherwise be dropped
    // by a newest-first cap.
    for (let i = 0; i < 25; i++) {
      await deps.memories.insert({
        userId,
        content: `fact ${i}`,
        pinned: i === 0,
      });
    }
    const settings = await deps.settings.getOrCreate(userId);

    const messages = await buildContext(deps, {
      userId,
      conversationId,
      settings,
      historyTokenBudget: 100000,
      historyLimit: 15,
      memoryLimit: 5,
    });

    const block = memoryBlock(messages);
    expect(block).toBeDefined();
    const lines = block!.split("\n").slice(1); // drop the header line
    expect(lines).toHaveLength(5); // capped
    expect(lines[0]).toContain("fact 0"); // pinned floats to the top despite being oldest
    expect(block).toContain("fact 24"); // newest still present
    expect(block).not.toContain("fact 1"); // squeezed out by the cap
  });

  it("omits the memory block entirely when there are no memories", async () => {
    const deps = makeAgentDeps(makeFakeLlm([]));
    const { userId, conversationId } = await provisionUser(deps, OWNER_ID);
    const settings = await deps.settings.getOrCreate(userId);

    const messages = await buildContext(deps, {
      userId,
      conversationId,
      settings,
      historyTokenBudget: 100000,
      historyLimit: 15,
      memoryLimit: 20,
    });

    expect(memoryBlock(messages)).toBeUndefined();
  });

  it("excludes legacy (pre-022) tool rows that have no tool_call_id linkage", async () => {
    const deps = makeAgentDeps(makeFakeLlm([]));
    const { userId, conversationId } = await provisionUser(deps, OWNER_ID);

    // Old-shape rows: a flattened "Used tool: …" audit summary and a bare tool result,
    // both role `tool` with no tool_call_id (how the loop persisted before structured
    // turns existed). These can't form a valid tool message, so they stay out of replay
    // — historical conversations behave exactly as they did before.
    await deps.messages.insert({
      conversationId,
      role: "user",
      content: "add milk",
      discordMessageId: "m1",
    });
    await deps.messages.insert({
      conversationId,
      role: "tool",
      content: 'Used tool: unforked({"action":"add_shopping_items","items":[{"name":"milk"}]})',
      discordMessageId: null,
    });
    await deps.messages.insert({
      conversationId,
      role: "tool",
      content: "Added to the 2026-W29 shopping list: milk.",
      discordMessageId: null,
    });
    await deps.messages.insert({
      conversationId,
      role: "assistant",
      content: "Done — milk's on the list.",
      discordMessageId: "m2",
    });
    const settings = await deps.settings.getOrCreate(userId);

    const messages = await buildContext(deps, {
      userId,
      conversationId,
      settings,
      historyTokenBudget: 100000,
      historyLimit: 15,
      memoryLimit: 20,
    });

    const replayed = messages.filter((m) => m.role === "user" || m.role === "assistant");
    expect(replayed.map((m) => m.content)).toEqual(["add milk", "Done — milk's on the list."]);
    expect(messages.some((m) => m.content?.includes("Used tool"))).toBe(false);
    expect(messages.some((m) => m.role === "tool")).toBe(false);
  });

  it("replays a structured tool turn faithfully (assistant tool_calls + linked result)", async () => {
    const deps = makeAgentDeps(makeFakeLlm([]));
    const { userId, conversationId } = await provisionUser(deps, OWNER_ID);

    await deps.messages.insert({
      conversationId,
      role: "user",
      content: "what reminders do I have?",
      discordMessageId: "m1",
    });
    await deps.messages.insert({
      conversationId,
      role: "assistant",
      content: null,
      toolCalls: [{ id: "call-1", name: "reminder", arguments: '{"action":"list"}' }],
      discordMessageId: null,
    });
    await deps.messages.insert({
      conversationId,
      role: "tool",
      content: "1. dentist Friday 09:00\n2. call mum tomorrow",
      toolCallId: "call-1",
      toolName: "reminder",
      discordMessageId: null,
    });
    await deps.messages.insert({
      conversationId,
      role: "assistant",
      content: "You've got the dentist Friday and calling your mum tomorrow.",
      discordMessageId: "m2",
    });
    const settings = await deps.settings.getOrCreate(userId);

    const messages = await buildContext(deps, {
      userId,
      conversationId,
      settings,
      historyTokenBudget: 100000,
      historyLimit: 15,
      memoryLimit: 20,
    });

    // The full exchange is replayed, including the tool call and its result, so a
    // follow-up like "what was the second one?" has the data to answer from.
    const replayed = messages.filter((m) => m.role !== "system");
    expect(replayed).toEqual([
      { role: "user", content: "what reminders do I have?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call-1", name: "reminder", arguments: '{"action":"list"}' }],
      },
      {
        role: "tool",
        content: "1. dentist Friday 09:00\n2. call mum tomorrow",
        tool_call_id: "call-1",
        name: "reminder",
      },
      {
        role: "assistant",
        content: "You've got the dentist Friday and calling your mum tomorrow.",
      },
    ]);
  });

  it("drops a leading orphan tool result when the window cuts mid-exchange", async () => {
    const deps = makeAgentDeps(makeFakeLlm([]));
    const { userId, conversationId } = await provisionUser(deps, OWNER_ID);

    // Persist a full tool turn followed by a plain turn. A tight window that begins on
    // the tool result (its assistant tool-call turn trimmed off) would be invalid — the
    // orphan tool row must be dropped so the replayed list stays valid.
    await deps.messages.insert({
      conversationId,
      role: "assistant",
      content: null,
      toolCalls: [{ id: "call-1", name: "reminder", arguments: '{"action":"list"}' }],
      discordMessageId: null,
    });
    await deps.messages.insert({
      conversationId,
      role: "tool",
      content: "1. dentist Friday",
      toolCallId: "call-1",
      toolName: "reminder",
      discordMessageId: null,
    });
    await deps.messages.insert({
      conversationId,
      role: "assistant",
      content: "You've got the dentist Friday.",
      discordMessageId: "m1",
    });
    await deps.messages.insert({
      conversationId,
      role: "user",
      content: "thanks",
      discordMessageId: "m2",
    });
    const settings = await deps.settings.getOrCreate(userId);

    // historyLimit 3 cuts off the assistant tool-call turn, leaving the tool result at
    // the front of the window.
    const messages = await buildContext(deps, {
      userId,
      conversationId,
      settings,
      historyTokenBudget: 100000,
      historyLimit: 3,
      memoryLimit: 20,
    });

    const replayed = messages.filter((m) => m.role !== "system");
    // No tool message survives without its preceding assistant tool-call turn.
    expect(replayed.some((m) => m.role === "tool")).toBe(false);
    expect(replayed[0]).toEqual({
      role: "assistant",
      content: "You've got the dentist Friday.",
    });
  });

  it("trims replayed history to the token budget, keeping the newest turns", async () => {
    const deps = makeAgentDeps(makeFakeLlm([]));
    const { userId, conversationId } = await provisionUser(deps, OWNER_ID);

    // Five ~100-char (≈25-token) user messages. A tight token budget should keep only
    // the newest couple, dropping the older ones even though the message-count cap is high.
    for (let i = 0; i < 5; i++) {
      await deps.messages.insert({
        conversationId,
        role: "user",
        content: `msg${i} ${"x".repeat(100)}`,
        discordMessageId: `m${i}`,
      });
    }
    const settings = await deps.settings.getOrCreate(userId);

    const messages = await buildContext(deps, {
      userId,
      conversationId,
      settings,
      historyTokenBudget: 60, // ~2 messages' worth
      historyLimit: 30,
      memoryLimit: 20,
    });

    const replayed = messages.filter((m) => m.role === "user");
    expect(replayed.length).toBeLessThan(5); // older turns trimmed by the token budget
    expect(replayed.length).toBeGreaterThan(0);
    // The newest message is always kept; the oldest is dropped.
    expect(replayed.at(-1)?.content).toContain("msg4");
    expect(replayed.some((m) => m.content?.includes("msg0"))).toBe(false);
  });

  it("keeps at least the newest message even if it alone exceeds the budget", async () => {
    const deps = makeAgentDeps(makeFakeLlm([]));
    const { userId, conversationId } = await provisionUser(deps, OWNER_ID);
    await deps.messages.insert({
      conversationId,
      role: "user",
      content: "x".repeat(1000), // far over the budget below
      discordMessageId: "m1",
    });
    const settings = await deps.settings.getOrCreate(userId);

    const messages = await buildContext(deps, {
      userId,
      conversationId,
      settings,
      historyTokenBudget: 10,
      historyLimit: 30,
      memoryLimit: 20,
    });

    // Dropping the latest turn entirely would be worse than overshooting once.
    expect(messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("grounds the prompt with the current local date/time", async () => {
    const deps = makeAgentDeps(
      makeFakeLlm([]),
      {},
      new FakeClock(new Date("2026-07-03T12:34:00Z")),
    );
    const { userId, conversationId } = await provisionUser(deps, OWNER_ID);
    const settings = await deps.settings.getOrCreate(userId);

    const messages = await buildContext(deps, {
      userId,
      conversationId,
      settings,
      historyTokenBudget: 100000,
      historyLimit: 15,
      memoryLimit: 20,
    });
    // 12:34Z = 14:34 in Europe/Oslo (default timezone) in July.
    const timeLine = messages.find((m) => m.content?.startsWith("Current date/time:"));
    expect(timeLine?.role).toBe("system");
    expect(timeLine?.content).toBe(
      "Current date/time: Friday 2026-07-03 14:34 (Europe/Oslo, GMT+02:00)",
    );
  });

  it("orders the prompt most-stable-first so the static head stays prefix-cacheable", async () => {
    const clock = new FakeClock(new Date("2026-07-03T12:34:00Z"));
    const deps = makeAgentDeps(makeFakeLlm([]), {}, clock);
    const { userId, conversationId } = await provisionUser(deps, OWNER_ID);
    await deps.memories.insert({ userId, content: "likes coffee", pinned: false });
    await deps.messages.insert({
      conversationId,
      role: "user",
      content: "hi",
      discordMessageId: "m1",
    });
    const settings = await deps.settings.getOrCreate(userId);
    const input = {
      userId,
      conversationId,
      settings,
      historyTokenBudget: 100000,
      historyLimit: 15,
      memoryLimit: 20,
    };

    const first = await buildContext(deps, input);
    // Static persona first, then memories, then the volatile time line, then history —
    // so the per-minute time churn invalidates as little of the cached prefix as possible.
    expect(first.map((m) => m.role)).toEqual(["system", "system", "system", "user"]);
    expect(first[0]?.content).not.toContain("Current date/time:");
    expect(first[1]?.content).toContain("What you remember");
    expect(first[2]?.content).toContain("Current date/time:");

    // A minute passing and a new memory arriving must leave the static head untouched.
    clock.advance(60_000);
    await deps.memories.insert({ userId, content: "afraid of spiders", pinned: false });
    const second = await buildContext(deps, input);
    expect(second[0]).toEqual(first[0]);
    expect(second[2]?.content).not.toEqual(first[2]?.content);
  });
});

describe("currentTimeLine", () => {
  it("falls back to UTC on an invalid timezone", () => {
    expect(currentTimeLine(new Date("2026-07-03T12:34:00Z"), "Not/AZone")).toBe(
      "Friday 2026-07-03 12:34 (UTC, GMT+00:00)",
    );
  });
});

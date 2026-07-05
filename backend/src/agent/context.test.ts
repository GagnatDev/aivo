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
      historyLimit: 15,
      memoryLimit: 20,
    });

    expect(memoryBlock(messages)).toBeUndefined();
  });

  it("grounds the system prompt with the current local date/time", async () => {
    const deps = makeAgentDeps(
      makeFakeLlm([]),
      {},
      new FakeClock(new Date("2026-07-03T12:34:00Z")),
    );
    const { userId, conversationId } = await provisionUser(deps, OWNER_ID);
    const settings = await deps.settings.getOrCreate(userId);

    const [system] = await buildContext(deps, {
      userId,
      conversationId,
      settings,
      historyLimit: 15,
      memoryLimit: 20,
    });
    // 12:34Z = 14:34 in Europe/Oslo (default timezone) in July.
    expect(system.content).toContain(
      "Current date/time: Friday 2026-07-03 14:34 (Europe/Oslo, GMT+02:00)",
    );
  });
});

describe("currentTimeLine", () => {
  it("falls back to UTC on an invalid timezone", () => {
    expect(currentTimeLine(new Date("2026-07-03T12:34:00Z"), "Not/AZone")).toBe(
      "Friday 2026-07-03 12:34 (UTC, GMT+00:00)",
    );
  });
});

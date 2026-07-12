import { describe, expect, it } from "vitest";
import { buildToolRegistry, type AgentTool, type ToolContext } from "./index.js";
import { FakeClock, makeAgentDeps, OWNER_ID, provisionUser } from "../../test/agentDeps.js";
import { useCleanDb } from "../../test/db.js";
import { makeFakeLlm } from "../../test/fakeLlm.js";

useCleanDb();

const NOW = new Date("2026-07-03T12:00:00Z");
const LATER = "2026-07-03T17:00:00+02:00"; // 15:00Z

const registry = buildToolRegistry();
const tool = (): AgentTool => {
  const t = registry.find((x) => x.schema.name === "reminder");
  if (!t) throw new Error("no reminder tool");
  return t;
};

async function ctxFor(discordId: string): Promise<ToolContext> {
  const deps = makeAgentDeps(makeFakeLlm([]), {}, new FakeClock(NOW));
  const { userId, isOwner, conversationId } = await provisionUser(deps, discordId);
  return { deps, userId, isOwner, conversationId };
}

describe("reminder tool", () => {
  it("sets a reminder and lists it", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const set = await tool().execute({ action: "set", text: "call X", due_at: LATER }, ctx);
    expect(set).toMatch(/Reminder set/);
    expect(set).toContain("2026-07-03T15:00:00.000Z");

    const list = JSON.parse(await tool().execute({ action: "list" }, ctx));
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("call X");
  });

  it("refuses to stack an exact duplicate of a pending reminder", async () => {
    const ctx = await ctxFor(OWNER_ID);
    await tool().execute({ action: "set", text: "call X", due_at: LATER }, ctx);
    // Same instant expressed in a different offset, text differing only in case/space.
    const dup = await tool().execute(
      { action: "set", text: "  Call x", due_at: "2026-07-03T15:00:00Z" },
      ctx,
    );
    expect(dup).toMatch(/already exists/);
    expect(JSON.parse(await tool().execute({ action: "list" }, ctx))).toHaveLength(1);

    // Same text at a different time is a distinct reminder, not a duplicate.
    const other = await tool().execute(
      { action: "set", text: "call X", due_at: "2026-07-03T18:00:00Z" },
      ctx,
    );
    expect(other).toMatch(/Reminder set/);
  });

  it("rejects a past or unparseable due_at", async () => {
    const ctx = await ctxFor(OWNER_ID);
    expect(
      await tool().execute({ action: "set", text: "x", due_at: "2026-07-03T11:00:00Z" }, ctx),
    ).toMatch(/in the past/);
    expect(await tool().execute({ action: "set", text: "x", due_at: "next tuesday" }, ctx)).toMatch(
      /couldn't parse/,
    );
    expect(await tool().execute({ action: "set", due_at: LATER }, ctx)).toMatch(/reminder text/);
  });

  it("cancels only the caller's own pending reminder", async () => {
    const owner = await ctxFor(OWNER_ID);
    const row = await owner.deps.reminders.insert({
      userId: owner.userId,
      text: "mine",
      dueAt: new Date(LATER),
    });

    const { userId: memberId } = await provisionUser(owner.deps, "member-1");
    const member: ToolContext = { ...owner, userId: memberId, isOwner: false };
    expect(await tool().execute({ action: "cancel", id: row.id }, member)).toMatch(/No such/);

    expect(await tool().execute({ action: "cancel", id: row.id }, owner)).toMatch(/Cancelled/);
    expect(await tool().execute({ action: "list" }, owner)).toBe("No upcoming reminders.");
  });

  it("reschedules a reminder to a new future time", async () => {
    const ctx = await ctxFor(OWNER_ID);
    const row = await ctx.deps.reminders.insert({
      userId: ctx.userId,
      text: "move me",
      dueAt: new Date(LATER),
    });
    const reply = await tool().execute(
      { action: "reschedule", id: row.id, due_at: "2026-07-04T09:00:00Z" },
      ctx,
    );
    expect(reply).toMatch(/Rescheduled/);
    expect((await ctx.deps.reminders.findById(row.id))?.due_at).toEqual(
      new Date("2026-07-04T09:00:00Z"),
    );
  });
});

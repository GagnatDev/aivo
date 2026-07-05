import { describe, expect, it } from "vitest";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";

useCleanDb();

const T0 = new Date("2026-07-03T10:00:00Z");
const T1 = new Date("2026-07-03T17:00:00Z");
const T2 = new Date("2026-07-04T09:00:00Z");

describe("ReminderRepository", () => {
  it("inserts pending and lists a user's reminders soonest-first", async () => {
    const deps = makeAgentDeps();
    const { userId } = await provisionUser(deps, OWNER_ID);
    await deps.reminders.insert({ userId, text: "later", dueAt: T2 });
    const first = await deps.reminders.insert({ userId, text: "call X", dueAt: T1 });

    expect(first.status).toBe("pending");
    const pending = await deps.reminders.listPending(userId);
    expect(pending.map((r) => r.text)).toEqual(["call X", "later"]);
  });

  it("listDue returns only pending reminders at/past due, across users", async () => {
    const deps = makeAgentDeps();
    const { userId: owner } = await provisionUser(deps, OWNER_ID);
    const { userId: member } = await provisionUser(deps, "member-1");
    const dueOwner = await deps.reminders.insert({ userId: owner, text: "a", dueAt: T0 });
    await deps.reminders.insert({ userId: member, text: "b", dueAt: T1 });
    await deps.reminders.insert({ userId: owner, text: "future", dueAt: T2 });
    const cancelled = await deps.reminders.insert({ userId: owner, text: "c", dueAt: T0 });
    await deps.reminders.cancel(cancelled.id, owner);

    const due = await deps.reminders.listDue(T1);
    expect(due.map((r) => r.text)).toEqual(["a", "b"]);

    await deps.reminders.markDelivered(dueOwner.id, T1);
    expect((await deps.reminders.listDue(T1)).map((r) => r.text)).toEqual(["b"]);
    expect((await deps.reminders.findById(dueOwner.id))?.delivered_at).toEqual(T1);
  });

  it("cancel is scoped to the owning user and to pending rows", async () => {
    const deps = makeAgentDeps();
    const { userId: owner } = await provisionUser(deps, OWNER_ID);
    const { userId: member } = await provisionUser(deps, "member-1");
    const r = await deps.reminders.insert({ userId: owner, text: "x", dueAt: T1 });

    expect(await deps.reminders.cancel(r.id, member)).toBeUndefined();
    expect((await deps.reminders.cancel(r.id, owner))?.status).toBe("cancelled");
    // Already cancelled — nothing to cancel again.
    expect(await deps.reminders.cancel(r.id, owner)).toBeUndefined();
  });

  it("reschedule re-arms a delivered reminder but never a cancelled one", async () => {
    const deps = makeAgentDeps();
    const { userId } = await provisionUser(deps, OWNER_ID);
    const r = await deps.reminders.insert({ userId, text: "snooze me", dueAt: T0 });
    await deps.reminders.markDelivered(r.id, T0);

    const rearmed = await deps.reminders.reschedule(r.id, userId, T2);
    expect(rearmed?.status).toBe("pending");
    expect(rearmed?.due_at).toEqual(T2);
    expect(rearmed?.delivered_at).toBeNull();

    await deps.reminders.cancel(r.id, userId);
    expect(await deps.reminders.reschedule(r.id, userId, T2)).toBeUndefined();
  });
});

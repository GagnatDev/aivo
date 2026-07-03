import { describe, expect, it } from "vitest";
import { FakeClock, makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";
import { makeFakeLlm } from "../test/fakeLlm.js";
import { resolveReminderClick, snoozeTarget } from "./reminderButtons.js";

useCleanDb();

// July: Europe/Oslo (the default settings timezone) is UTC+2.
const NOW = new Date("2026-07-03T12:00:00Z");

async function setup() {
  const deps = makeAgentDeps(makeFakeLlm([]), {}, new FakeClock(NOW));
  const { userId } = await provisionUser(deps, OWNER_ID);
  const reminder = await deps.reminders.insert({ userId, text: "call X", dueAt: NOW });
  await deps.reminders.markDelivered(reminder.id, NOW);
  return { deps, userId, reminder };
}

const click = (customId: string, clicker = OWNER_ID) => ({
  customId,
  clickerDiscordId: clicker,
  clickerDisplayName: null,
});

describe("snoozeTarget", () => {
  it("offsets 10m/1h from now and lands tomorrow 09:00 local for 'tomorrow'", () => {
    expect(snoozeTarget("10m", NOW, "Europe/Oslo")).toEqual(new Date("2026-07-03T12:10:00Z"));
    expect(snoozeTarget("1h", NOW, "Europe/Oslo")).toEqual(new Date("2026-07-03T13:00:00Z"));
    // 09:00 Oslo (UTC+2 in July) = 07:00Z the next day.
    expect(snoozeTarget("tomorrow", NOW, "Europe/Oslo")).toEqual(new Date("2026-07-04T07:00:00Z"));
    // A bad user-set timezone falls back to UTC rather than crashing the click.
    expect(snoozeTarget("tomorrow", NOW, "Not/AZone")).toEqual(new Date("2026-07-04T09:00:00Z"));
  });
});

describe("resolveReminderClick", () => {
  it("ignores non-reminder customIds", async () => {
    const { deps } = await setup();
    expect(await resolveReminderClick(deps, click("fb:keep:item-1"))).toBeNull();
    expect(await resolveReminderClick(deps, click("rem:2h:some-id"))).toBeNull();
  });

  it("re-arms the reminder for the snoozed interval", async () => {
    const { deps, reminder } = await setup();
    const res = await resolveReminderClick(deps, click(`rem:1h:${reminder.id}`));
    expect(res?.ack).toMatch(/in 1 hour/);
    const row = await deps.reminders.findById(reminder.id);
    expect(row?.status).toBe("pending");
    expect(row?.due_at).toEqual(new Date("2026-07-03T13:00:00Z"));
  });

  it("only the reminder's own user can snooze it", async () => {
    const { deps, reminder } = await setup();
    const res = await resolveReminderClick(deps, click(`rem:10m:${reminder.id}`, "member-1"));
    expect(res?.ack).toMatch(/someone else's reminder/);
    expect((await deps.reminders.findById(reminder.id))?.status).toBe("delivered");
  });

  it("acknowledges gone or cancelled reminders without failing", async () => {
    const { deps, userId, reminder } = await setup();
    const gone = await resolveReminderClick(
      deps,
      click("rem:10m:00000000-0000-0000-0000-000000000000"),
    );
    expect(gone?.ack).toMatch(/gone/);

    await deps.reminders.reschedule(reminder.id, userId, new Date("2026-08-01T00:00:00Z"));
    await deps.reminders.cancel(reminder.id, userId);
    const cancelled = await resolveReminderClick(deps, click(`rem:10m:${reminder.id}`));
    expect(cancelled?.ack).toMatch(/cancelled/);
  });
});

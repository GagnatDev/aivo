import { describe, expect, it } from "vitest";
import type { ReminderRow } from "../storage/reminderRepository.js";
import { reminderMessage, snoozeButtons, REMINDER_PREFIX } from "./reminderDelivery.js";

const reminder: ReminderRow = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "u-1",
  text: "call the dentist",
  due_at: new Date("2026-07-03T15:00:00Z"),
  status: "pending",
  delivered_at: null,
  created_at: new Date("2026-07-01T00:00:00Z"),
};

describe("reminderMessage", () => {
  it("mentions the user and carries the reminder text", () => {
    expect(reminderMessage(reminder, "discord-123", "en")).toBe(
      "<@discord-123> ⏰ **Reminder:** call the dentist",
    );
  });

  it("degrades gracefully without a discord id", () => {
    expect(reminderMessage(reminder, null, "en")).toBe("⏰ **Reminder:** call the dentist");
  });

  it("renders the label in Norwegian", () => {
    expect(reminderMessage(reminder, null, "nb")).toBe("⏰ **Påminnelse:** call the dentist");
  });
});

describe("snoozeButtons", () => {
  it("renders the three snooze options with rem:<option>:<id> custom ids", () => {
    const row = snoozeButtons(reminder.id, "en").toJSON();
    const ids = row.components.map((c) => ("custom_id" in c ? c.custom_id : ""));
    expect(ids).toEqual([
      `${REMINDER_PREFIX}:10m:${reminder.id}`,
      `${REMINDER_PREFIX}:1h:${reminder.id}`,
      `${REMINDER_PREFIX}:tomorrow:${reminder.id}`,
    ]);
  });
});

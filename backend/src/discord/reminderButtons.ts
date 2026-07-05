import type { AgentDeps } from "../agent/deps.js";
import { localDate } from "../digest/due.js";
import { REMINDER_PREFIX, type SnoozeOption } from "./reminderDelivery.js";

/**
 * Resolve a reminder snooze-button click (customId `rem:<option>:<reminder_id>`)
 * against the database. Discord-thin (no interaction object) so it's unit-testable;
 * the gateway applies the returned ack as an ephemeral reply. Snoozing re-arms the
 * same reminder row with a new due time — only the reminder's own user may snooze
 * (reminders are per-user data, unlike the shared digest feedback buttons).
 */

const TOMORROW_HOUR = 9; // "snooze until tomorrow" = 09:00 local — a morning nudge, not 24h later
const SNOOZE_MS: Record<Exclude<SnoozeOption, "tomorrow">, number> = {
  "10m": 10 * 60_000,
  "1h": 60 * 60_000,
};

export interface ReminderClick {
  customId: string;
  clickerDiscordId: string;
  clickerDisplayName: string | null;
}

/** The instant a snooze option re-arms to, in the user's configured timezone. */
export function snoozeTarget(option: SnoozeOption, now: Date, timezone: string): Date {
  if (option !== "tomorrow") return new Date(now.getTime() + SNOOZE_MS[option]);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
  return zonedInstant(localDate(tomorrow, timezone), TOMORROW_HOUR, timezone);
}

/** Handle a snooze click; null when the customId isn't a reminder button. */
export async function resolveReminderClick(
  deps: AgentDeps,
  click: ReminderClick,
): Promise<{ ack: string } | null> {
  const [prefix, option, reminderId] = click.customId.split(":");
  if (prefix !== REMINDER_PREFIX || !reminderId) return null;
  if (option !== "10m" && option !== "1h" && option !== "tomorrow") return null;

  const reminder = await deps.reminders.findById(reminderId);
  if (!reminder) return { ack: "That reminder is gone — nothing to snooze." };
  if (reminder.status === "cancelled") return { ack: "That reminder was cancelled." };

  const clicker = await deps.users.upsertByDiscordId({
    discordUserId: click.clickerDiscordId,
    displayName: click.clickerDisplayName,
    isOwner: click.clickerDiscordId === deps.ownerDiscordUserId,
  });
  if (clicker.id !== reminder.user_id) {
    return { ack: "That's someone else's reminder — only they can snooze it." };
  }

  const settings = await deps.settings.getOrCreate(reminder.user_id);
  const dueAt = snoozeTarget(option, deps.clock.now(), settings.timezone);
  await deps.reminders.reschedule(reminder.id, reminder.user_id, dueAt);
  const when =
    option === "tomorrow"
      ? `tomorrow at ${String(TOMORROW_HOUR).padStart(2, "0")}:00`
      : `in ${option === "10m" ? "10 minutes" : "1 hour"}`;
  return { ack: `Snoozed — I'll remind you again ${when}.` };
}

/**
 * The UTC instant of `date` (YYYY-MM-DD) at `hour` local wall-clock time in
 * `timeZone`. Interprets the wall-clock time as UTC, then corrects by the zone's
 * offset at that instant; the second pass converges across a DST boundary. Falls
 * back to UTC on a bad timezone string, matching digest/due.ts.
 */
function zonedInstant(date: string, hour: number, timeZone: string): Date {
  const naive = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  let instant = new Date(naive);
  for (let i = 0; i < 2; i++) {
    instant = new Date(naive - (wallClockAsUtc(instant, timeZone) - instant.getTime()));
  }
  return instant;
}

/** `instant`'s wall-clock reading in `timeZone`, re-parsed as if it were UTC (ms). */
function wallClockAsUtc(instant: Date, timeZone: string): number {
  let fmt: Intl.DateTimeFormat;
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" });
  }
  const parts = fmt.formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return Date.parse(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
  );
}

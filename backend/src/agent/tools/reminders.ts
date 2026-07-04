import { z } from "zod";
import { parse, type AgentTool, type ToolContext } from "./index.js";

/**
 * The chat control surface for reminders: set one, list what's coming, cancel, and
 * reschedule ("make it 6 instead"). Delivery itself is the scheduler's job — the
 * minutely tick posts due reminders to the home channel (DISCORD_HOME_CHANNEL_ID,
 * the concept docs' "#chat" lane) with snooze buttons. Reminders are
 * per-user (not owner-gated): every action is scoped to the calling user in the
 * repository, so one user can't touch another's reminders.
 *
 * The model converts natural language ("in 20 minutes", "tomorrow at 5") into an
 * absolute ISO-8601 `due_at` using the current date/time line in the system prompt;
 * the tool only validates that the result parses and is in the future.
 */

const reminderArgs = z.object({
  action: z.enum(["set", "list", "cancel", "reschedule"]),
  text: z.string().min(1).optional(),
  due_at: z.string().optional(),
  id: z.string().uuid("id must be the reminder's uuid from a 'list'").optional(),
});

export const remindersTool: AgentTool = {
  gate: /\bremind\w*|\bsnooze\b/i,
  schema: {
    name: "reminder",
    description:
      "Set, list, cancel, or reschedule the user's reminders (delivered proactively in " +
      "Discord when due). Actions: 'set' (text + due_at); 'list' (upcoming reminders — " +
      "answer 'what reminders do I have?'); 'cancel' (id); 'reschedule' (id + due_at, also " +
      "for snoozing). due_at must be an absolute ISO-8601 timestamp WITH a UTC offset " +
      "(e.g. 2026-07-04T17:00:00+02:00) — compute it from the current date/time and " +
      "timezone given in the system prompt; never guess. If the user's phrasing is " +
      "ambiguous (e.g. 'at 5' could be 05:00 or 17:00), ask before setting.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["set", "list", "cancel", "reschedule"] },
        text: { type: "string", description: "what to remind about (action=set)" },
        due_at: {
          type: "string",
          description: "absolute ISO-8601 time with offset (action=set/reschedule)",
        },
        id: { type: "string", description: "reminder id from 'list' (action=cancel/reschedule)" },
      },
      required: ["action"],
    },
  },
  async execute(args, ctx) {
    const p = parse(reminderArgs, args);
    if (!p.ok) return p.error;
    const a = p.value;

    switch (a.action) {
      case "set": {
        if (!a.text) return "Provide the reminder text.";
        const due = parseDueAt(a.due_at, ctx);
        if (typeof due === "string") return due;
        const row = await ctx.deps.reminders.insert({
          userId: ctx.userId,
          text: a.text,
          dueAt: due,
        });
        return `Reminder set (id ${row.id}): "${row.text}" at ${row.due_at.toISOString()}.`;
      }
      case "list": {
        const rows = await ctx.deps.reminders.listPending(ctx.userId);
        if (rows.length === 0) return "No upcoming reminders.";
        return JSON.stringify(
          rows.map((r) => ({ id: r.id, text: r.text, due_at: r.due_at.toISOString() })),
        );
      }
      case "cancel": {
        if (!a.id) return "Provide the reminder 'id' (from a list).";
        const row = await ctx.deps.reminders.cancel(a.id, ctx.userId);
        return row ? `Cancelled: "${row.text}".` : "No such pending reminder of yours.";
      }
      case "reschedule": {
        if (!a.id) return "Provide the reminder 'id' (from a list).";
        const due = parseDueAt(a.due_at, ctx);
        if (typeof due === "string") return due;
        const row = await ctx.deps.reminders.reschedule(a.id, ctx.userId, due);
        return row
          ? `Rescheduled: "${row.text}" now due at ${row.due_at.toISOString()}.`
          : "No such reminder of yours (cancelled ones can't be rescheduled — set a new one).";
      }
    }
  },
};

/** Validate due_at: parseable and in the future. Returns the Date or an error string. */
function parseDueAt(dueAt: string | undefined, ctx: ToolContext): Date | string {
  if (!dueAt) return "Provide 'due_at' as an absolute ISO-8601 time with offset.";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return "I couldn't parse due_at — use ISO-8601 with a UTC offset, e.g. 2026-07-04T17:00:00+02:00.";
  }
  if (due <= ctx.deps.clock.now()) {
    return `due_at (${due.toISOString()}) is in the past — re-check it against the current time in the system prompt.`;
  }
  return due;
}

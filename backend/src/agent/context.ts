import type { ChatMessage } from "../llm/provider.js";
import type { MessageRow } from "../storage/messageRepository.js";
import type { SettingsRow } from "../storage/settingsRepository.js";
import type { AgentDeps } from "./deps.js";

/**
 * The base persona + operating rules. Concise, dry, direct — a competent chief of
 * staff that doesn't pad replies (concept.md). The guardrail clauses reduce spurious
 * tool calls but are NOT the security boundary — owner-only actions are enforced in
 * the tools themselves regardless of what this says.
 */
export const BASE_PERSONA = [
  "You are Aivo, a personal AI assistant — a competent chief of staff living in Discord.",
  "Be concise, dry, and direct: answer in 1–3 sentences unless asked for detail. No filler.",
  "Tools: memory (remember/recall/forget facts), budget (report spend, set caps/tier),",
  "models (inspect/configure the model & pricing table), settings, youtube_digest",
  "(the YouTube daily digest: status, delivery hour/interval/cap, pause or turn off,",
  "resume, run now, interest profile, feedback, mute channels), reminder (set/list/",
  "cancel/reschedule reminders, delivered proactively when due).",
  "",
  "Operating rules:",
  "- Most messages need NO tools — just reply. Call a tool only when it's needed to answer,",
  "  prefer the fewest calls, never speculatively, and never repeat the same call this turn.",
  "- Ask before doing anything ambiguous or hard to reverse.",
  "- Never claim you did something (added to the shopping list, set a reminder, changed a",
  "  setting) unless a tool call THIS turn returned success. If the tool isn't available or",
  "  it failed, say plainly that you couldn't — never fabricate a confirmation.",
  "- Only change model/pricing config when the owner explicitly asks, using exact figures",
  "  they state — never guess, infer, or 'fix' prices on your own (details in the models tool).",
  "- You act only on the current user's data; never change another person's settings.",
].join("\n");

/**
 * "Friday 2026-07-03 14:05 (Europe/Oslo, GMT+02:00)" for the system prompt — weekday
 * and offset included so the model can do calendar math and emit ISO times with the
 * right offset. Falls back to UTC on a bad user-set timezone (same policy as
 * digest/due.ts) rather than failing the turn.
 */
export function currentTimeLine(now: Date, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  };
  let zone = timeZone;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone });
  } catch {
    zone = "UTC";
    fmt = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" });
  }
  const parts = fmt.formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return (
    `${get("weekday")} ${get("year")}-${get("month")}-${get("day")} ` +
    `${get("hour")}:${get("minute")} (${zone}, ${get("timeZoneName")})`
  );
}

export interface BuildContextInput {
  userId: string;
  conversationId: string;
  settings: SettingsRow;
  /** Most recent messages to include (oldest-first), already capped by the caller. */
  historyLimit: number;
  /** Max remembered facts to inject (pinned first, then newest); the rest stay
   * reachable via the memory tool. Bounds per-call prompt growth. */
  memoryLimit: number;
}

/**
 * Reconstruct the running exchange from stored rows, preserving tool structure so the
 * model can see what tools returned in earlier turns. Each persisted row maps back to
 * its provider-agnostic {@link ChatMessage}:
 * - `user` / plain `assistant` → text, as before.
 * - `assistant` with a `tool_calls` array → the structured tool-request turn (its
 *   content is often null, which is valid and kept).
 * - `tool` with a `tool_call_id` → a tool result linked to the call it answers.
 *
 * Rows that can't form a valid message are dropped: a degenerate assistant row with
 * neither text nor tool calls, and — crucially — any `tool` row without a
 * `tool_call_id`. The latter covers every pre-022 row (the old flattened "Used tool: …"
 * audit summaries and bare tool results), so historical conversations replay exactly as
 * they did before structured persistence existed: user/assistant text only.
 */
function toReplayMessage(row: MessageRow): ChatMessage | null {
  switch (row.role) {
    case "user":
      return row.content === null ? null : { role: "user", content: row.content };
    case "assistant": {
      if (row.tool_calls?.length) {
        return { role: "assistant", content: row.content, tool_calls: row.tool_calls };
      }
      return row.content === null ? null : { role: "assistant", content: row.content };
    }
    case "tool":
      // No tool_call_id ⇒ a legacy/audit row with no structured linkage; the model can't
      // consume it as a tool result, so it stays out of the replayed context.
      if (!row.tool_call_id) return null;
      return {
        role: "tool",
        content: row.content ?? "",
        tool_call_id: row.tool_call_id,
        ...(row.tool_name ? { name: row.tool_name } : {}),
      };
    default:
      return null;
  }
}

/**
 * Drop leading `tool` messages from a windowed slice. A recent-history window is a
 * contiguous suffix of the conversation, so the only way tool linkage breaks is at the
 * front: a tool result whose assistant tool-call turn fell before the window boundary.
 * Such an orphan would make the message list invalid (a `tool` message with no
 * preceding matching `tool_calls`). Every other tool row in the suffix is still preceded
 * by its assistant turn — they're persisted consecutively — so trimming the front is
 * sufficient to keep the whole window valid.
 */
function dropLeadingOrphanToolResults(messages: ChatMessage[]): ChatMessage[] {
  let start = 0;
  while (start < messages.length && messages[start]?.role === "tool") start++;
  return messages.slice(start);
}

/**
 * Assemble the LLM message list: a system prompt (base persona + the user's
 * persona_prompt addendum), an optional block of known memories, then the recent
 * conversation transcript replayed with its tool structure intact (see
 * {@link toReplayMessage}).
 */
export async function buildContext(
  deps: AgentDeps,
  input: BuildContextInput,
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];

  let system = BASE_PERSONA;
  // Ground relative time ("in 20 minutes", "tomorrow at 5") — without this line the
  // model cannot produce the absolute due_at the reminder tool requires.
  system += `\n\nCurrent date/time: ${currentTimeLine(deps.clock.now(), input.settings.timezone)}`;
  if (input.settings.persona_prompt) {
    system += `\n\nUser's style preference: ${input.settings.persona_prompt}`;
  }
  messages.push({ role: "system", content: system });

  // listActive is newest-first; pin-prioritize, then cap. Memories beyond the cap
  // remain reachable on demand via the memory tool (list/search), so this bounds
  // the per-call prompt without dropping recall.
  const memories = await deps.memories.listActive(input.userId);
  if (memories.length) {
    const ordered = [...memories].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    const lines = ordered
      .slice(0, input.memoryLimit)
      .map((m) => `- ${m.category ? `[${m.category}] ` : ""}${m.content}`);
    messages.push({
      role: "system",
      content: `What you remember about this user:\n${lines.join("\n")}`,
    });
  }

  const history = await deps.messages.listByConversation(input.conversationId);
  const replayable = history
    .map(toReplayMessage)
    .filter((m): m is ChatMessage => m !== null)
    .slice(-input.historyLimit);
  for (const m of dropLeadingOrphanToolResults(replayable)) {
    messages.push(m);
  }

  return messages;
}

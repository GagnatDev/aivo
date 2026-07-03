import type { ChatMessage } from "../llm/provider.js";
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
 * Assemble the LLM message list: a system prompt (base persona + the user's
 * persona_prompt addendum), an optional block of known memories, then the recent
 * conversation transcript. Only user/assistant text is replayed from history — the
 * intermediate tool/assistant-with-tool-calls rows are persisted for audit but not
 * reconstructed across turns (they lack the structured tool_call linkage), which keeps
 * the replayed message list valid for the provider.
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
  const recent = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content !== null)
    .slice(-input.historyLimit);
  for (const m of recent) {
    messages.push({ role: m.role as "user" | "assistant", content: m.content });
  }

  return messages;
}

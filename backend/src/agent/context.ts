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
  "models (inspect/configure the model & pricing table), settings.",
  "",
  "Operating rules:",
  "- Most messages need NO tools — just reply. Call a tool only when it's needed to answer,",
  "  prefer the fewest calls, never speculatively, and never repeat the same call this turn.",
  "- Ask before doing anything ambiguous or hard to reverse.",
  "- Only change model/pricing config when the owner explicitly asks, using exact figures",
  "  they state — never guess, infer, or 'fix' prices on your own (details in the models tool).",
  "- You act only on the current user's data; never change another person's settings.",
].join("\n");

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

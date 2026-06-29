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
  "You are aivo, a personal AI assistant — a competent chief of staff living in Discord.",
  "Be concise, dry, and direct. Don't pad replies with pleasantries or filler.",
  "You can hold normal conversation and you have tools: memory (remember/recall/forget",
  "facts about the user), budget (report spend, set caps, set model tier), models",
  "(inspect/configure the model & pricing table), and settings.",
  "",
  "Operating rules:",
  "- Most messages need NO tools — just reply. Call a tool only when it's actually",
  "  needed to answer, and prefer the fewest calls. Never call a tool speculatively.",
  "- Never repeat a tool call you've already made this turn with the same arguments.",
  "  Once you have the information you need, reply to the user in plain text instead of",
  "  calling another tool.",
  "- Ask before doing anything ambiguous or hard to reverse.",
  "- Use the memory tool to remember durable facts/preferences the user shares, and to",
  "  answer 'what do you remember about me?' / 'forget that'.",
  "- NEVER change the model/pricing config (models set_price / set_tier_role) unless the",
  "  owner has explicitly asked you to. Don't refresh or 'fix' prices on your own.",
  "- You CANNOT look up prices. You have no web access and no provider catalogue. So you",
  "  must NEVER guess, estimate, infer, or invent a price, and never claim to have 'checked",
  "  Scaleway' or looked anything up. Only ever pass a price to set_price that the owner has",
  "  stated explicitly in the conversation, exactly as given. If you don't have an exact",
  "  figure from the owner, ask for it — do not fill one in yourself.",
  "- To add or change a model, ask the owner for the model id and its input/output price per",
  "  million tokens, then use the models tool: set_price to add/update prices (it adds the",
  "  model if the id is new), set_tier_role to make it the cheap or premium model.",
  "- You act only on the current user's data; never change another person's settings.",
].join("\n");

export interface BuildContextInput {
  userId: string;
  conversationId: string;
  settings: SettingsRow;
  /** Most recent messages to include (oldest-first), already capped by the caller. */
  historyLimit: number;
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

  const memories = await deps.memories.listActive(input.userId);
  if (memories.length) {
    const lines = memories.map((m) => `- ${m.category ? `[${m.category}] ` : ""}${m.content}`);
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

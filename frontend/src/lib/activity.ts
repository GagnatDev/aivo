// Types mirroring the dashboard activity API (backend routes/dashboard/activity.ts)
// and the labels the Activity Log page renders with.

export type Channel = "chat" | "youtube" | "mail";
export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface ConversationSummary {
  id: string;
  channel: Channel;
  createdAt: string;
  lastMessageAt: string;
}

export interface Conversations {
  conversations: ConversationSummary[];
}

/** A tool call recorded on an assistant turn (mirrors the backend `StoredToolCall`). */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ThreadMessage {
  id: string;
  role: MessageRole;
  content: string | null;
  /** Set on an assistant turn that requested tools (migration 022). */
  toolCalls: ToolCall[] | null;
  /** Set on a tool-result row: the tool that produced it. */
  toolName: string | null;
  createdAt: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

/** How an agent turn ended (mirrors the backend `TurnOutcome`). */
export type TurnOutcome =
  | "final_answer"
  | "forced_answer"
  | "iteration_cap"
  | "cost_ceiling"
  | "provider_error"
  | "aborted";

/**
 * The per-turn observability record the agent loop persists on every exit path
 * (backend `turn_summaries`) — what a single message row can't say: how many model
 * round-trips the turn took, how long it ran, and how it ended.
 */
export interface TurnSummary {
  id: string;
  turnId: string;
  outcome: TurnOutcome;
  iterations: number;
  toolsCalled: string[];
  toolErrors: number;
  tokensIn: number;
  tokensOut: number;
  /** Fractional cents — a display copy of the turn's spend, not the billing ledger. */
  costCents: number;
  latencyMs: number;
  finishReasons: string[];
  createdAt: string;
}

export interface MessagesPage {
  conversation: { id: string; channel: Channel };
  messages: ThreadMessage[];
  /** Turn records covering the same window as `messages`, oldest first. */
  turns: TurnSummary[];
  hasMore: boolean;
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  chat: "#chat",
  youtube: "#youtube",
  mail: "#mail",
};

export const ROLE_LABELS: Record<MessageRole, string> = {
  user: "You",
  assistant: "Aivo",
  tool: "Tool",
  system: "System",
};

/** "Jul 1, 14:32" stamp for thread messages and conversation activity. */
export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Short label per turn outcome — only `final_answer` is the uneventful one. */
export const TURN_OUTCOME_LABELS: Record<TurnOutcome, string> = {
  final_answer: "answered",
  forced_answer: "forced answer (stuck)",
  iteration_cap: "hit iteration cap",
  cost_ceiling: "hit cost ceiling",
  provider_error: "provider error",
  aborted: "aborted",
};

/** A turn that ended any way other than a clean answer is worth flagging in the thread. */
export function isDegradedOutcome(outcome: TurnOutcome): boolean {
  return outcome !== "final_answer";
}

/** "1.4s" / "820ms" — turn latency at the precision a human reads it at. */
export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The thread renders messages and turn records in one time-ordered list: a turn's
 * record is written when the turn finishes, so it lands just after the last message
 * it covers. Returned oldest-first, the order both sides are already sorted in.
 */
export type ThreadEntry =
  | { kind: "message"; at: string; message: ThreadMessage }
  | { kind: "turn"; at: string; turn: TurnSummary };

export function mergeThreadEntries(messages: ThreadMessage[], turns: TurnSummary[]): ThreadEntry[] {
  const entries: ThreadEntry[] = [
    ...messages.map((message) => ({ kind: "message" as const, at: message.createdAt, message })),
    ...turns.map((turn) => ({ kind: "turn" as const, at: turn.createdAt, turn })),
  ];
  // Stable sort keeps a turn record after the message it shares a timestamp with —
  // messages are listed first above, and Array#sort has been stable since ES2019.
  return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

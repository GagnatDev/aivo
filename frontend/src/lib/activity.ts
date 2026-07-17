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

export interface MessagesPage {
  conversation: { id: string; channel: Channel };
  messages: ThreadMessage[];
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

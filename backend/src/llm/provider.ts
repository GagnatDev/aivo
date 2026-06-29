/**
 * Provider-agnostic LLM contract. Every LLM call in aivo goes through this interface
 * so the concrete provider (OpenAI SDK pointed at Scaleway) can be swapped without
 * touching the agent core. Tool-calling is orchestrated in-house against these types
 * — no agent framework.
 */

/** Author role of a chat message, matching the OpenAI chat schema. */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** A function/tool call the model asked for. `arguments` is a raw JSON string. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * One message in the running exchange. `tool_calls` is set on an assistant message
 * that requested tools; `tool_call_id` + `name` identify a `tool`-role result.
 */
export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** A tool the model may call, described with a JSON Schema for its arguments. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  /** Upper bound on completion tokens — also the worst-case used by cost estimation. */
  maxTokens: number;
}

export interface TokenUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface ChatResult {
  /** The assistant's text, or null when it only returned tool calls. */
  content: string | null;
  toolCalls: ToolCall[];
  usage: TokenUsage;
}

export interface LlmProvider {
  /** Run one chat completion (possibly returning tool calls). */
  chat(req: ChatRequest): Promise<ChatResult>;
  /**
   * Estimate the input-token count for a prepared request, used by the pre-call
   * approval-gate cost estimate. Approximate by design (see llm/tokens.ts).
   */
  countTokens(messages: ChatMessage[], tools?: ToolSchema[]): number;
}

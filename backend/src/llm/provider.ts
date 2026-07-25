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
  /**
   * Aborts the in-flight request (graceful shutdown, or a future user-facing "stop").
   * The provider surfaces an aborted call as an `aborted` {@link LlmErrorKind}, which is
   * never retried.
   */
  signal?: AbortSignal;
}

export interface TokenUsage {
  tokensIn: number;
  tokensOut: number;
}

/**
 * Why the model stopped, normalized to a provider-agnostic union: `stop` is a clean
 * finish, `length` means the output-token cap cut the completion off mid-generation
 * (text or tool-call JSON — never assume a clean finish), `tool_calls` means it stopped
 * to call tools, `other` covers anything else (content filter, unknown provider values).
 */
export type FinishReason = "stop" | "length" | "tool_calls" | "other";

export interface ChatResult {
  /** The assistant's text, or null when it only returned tool calls. */
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: TokenUsage;
}

/** One audio file to transcribe, held in memory (aivo has no object storage). */
export interface TranscriptionRequest {
  /** The transcription model id (e.g. a Scaleway whisper/voxtral id). */
  model: string;
  /** The raw audio bytes. */
  audio: Buffer;
  /** File name whose extension signals the format to the provider (e.g. `voice.ogg`). */
  filename: string;
  /** MIME type of the audio (e.g. `audio/ogg`). */
  contentType: string;
}

export interface TranscriptionResult {
  /** The transcribed text. */
  text: string;
  /**
   * Audio length in seconds if the provider reports it. Often absent; the caller falls
   * back to the duration Discord already attached to the voice message for cost metering.
   */
  durationSeconds?: number;
}

export interface LlmProvider {
  /** Run one chat completion (possibly returning tool calls). */
  chat(req: ChatRequest): Promise<ChatResult>;
  /**
   * Estimate the input-token count for a prepared request, used by the pre-call
   * approval-gate cost estimate. Approximate by design (see llm/tokens.ts).
   */
  countTokens(messages: ChatMessage[], tools?: ToolSchema[]): number;
  /** Transcribe an audio file to text (OpenAI-compatible `/audio/transcriptions`). */
  transcribe(req: TranscriptionRequest): Promise<TranscriptionResult>;
}

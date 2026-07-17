import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  FinishReason,
  LlmProvider,
  ToolSchema,
  TranscriptionRequest,
  TranscriptionResult,
} from "../llm/provider.js";
import { estimateRequestTokens } from "../llm/tokens.js";

export interface FakeLlm extends LlmProvider {
  /** Requests captured in call order, for assertions. */
  readonly calls: ChatRequest[];
  /** Transcription requests captured in call order, for assertions. */
  readonly transcribeCalls: TranscriptionRequest[];
}

/**
 * A scripted LlmProvider for tests. `chat()` returns the next pre-baked result in
 * sequence, so a test can drive an exact tool-calling path (e.g. first a tool call,
 * then a final answer). A scripted `Error` is thrown instead of returned, so a test can
 * simulate a provider failure of a specific taxonomy `kind`. `countTokens` uses the
 * real heuristic so estimates are deterministic. If `fixedInputTokens` is given,
 * countTokens returns it instead — handy for forcing the approval gate. `transcribe`
 * returns `opts.transcript` (default a fixed string) and records the call; pass an
 * `Error` as `transcript` to simulate a provider failure.
 */
export function makeFakeLlm(
  script: (ChatResult | Error)[],
  opts: { fixedInputTokens?: number; transcript?: TranscriptionResult | Error } = {},
): FakeLlm {
  const calls: ChatRequest[] = [];
  const transcribeCalls: TranscriptionRequest[] = [];
  let i = 0;
  return {
    calls,
    transcribeCalls,
    async chat(req: ChatRequest): Promise<ChatResult> {
      calls.push(req);
      const next = script[i++];
      if (!next) throw new Error(`fakeLlm: no scripted result for call #${i}`);
      if (next instanceof Error) throw next;
      return next;
    },
    countTokens(messages: ChatMessage[], tools?: ToolSchema[]): number {
      return opts.fixedInputTokens ?? estimateRequestTokens(messages, tools);
    },
    async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
      transcribeCalls.push(req);
      const t = opts.transcript ?? { text: "transcribed text" };
      if (t instanceof Error) throw t;
      return t;
    },
  };
}

/** A ChatResult with plain text and no tool calls. */
export function textResult(
  content: string,
  tokensOut = 10,
  finishReason: FinishReason = "stop",
): ChatResult {
  return { content, toolCalls: [], finishReason, usage: { tokensIn: 20, tokensOut } };
}

/** A ChatResult asking to call a single tool. */
export function toolCallResult(
  name: string,
  args: Record<string, unknown>,
  id = "call-1",
  finishReason: FinishReason = "tool_calls",
): ChatResult {
  return {
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    finishReason,
    usage: { tokensIn: 20, tokensOut: 5 },
  };
}

/** A ChatResult whose tool call was cut off mid-JSON by the output-token cap. */
export function truncatedToolCallResult(name: string, partialArgs: string): ChatResult {
  return {
    content: null,
    toolCalls: [{ id: "call-1", name, arguments: partialArgs }],
    finishReason: "length",
    usage: { tokensIn: 20, tokensOut: 5 },
  };
}

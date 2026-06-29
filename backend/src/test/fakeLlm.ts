import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  LlmProvider,
  ToolSchema,
} from "../llm/provider.js";
import { estimateRequestTokens } from "../llm/tokens.js";

export interface FakeLlm extends LlmProvider {
  /** Requests captured in call order, for assertions. */
  readonly calls: ChatRequest[];
}

/**
 * A scripted LlmProvider for tests. `chat()` returns the next pre-baked result in
 * sequence, so a test can drive an exact tool-calling path (e.g. first a tool call,
 * then a final answer). `countTokens` uses the real heuristic so estimates are
 * deterministic. If `fixedInputTokens` is given, countTokens returns it instead —
 * handy for forcing the approval gate.
 */
export function makeFakeLlm(
  script: ChatResult[],
  opts: { fixedInputTokens?: number } = {},
): FakeLlm {
  const calls: ChatRequest[] = [];
  let i = 0;
  return {
    calls,
    async chat(req: ChatRequest): Promise<ChatResult> {
      calls.push(req);
      const next = script[i++];
      if (!next) throw new Error(`fakeLlm: no scripted result for call #${i}`);
      return next;
    },
    countTokens(messages: ChatMessage[], tools?: ToolSchema[]): number {
      return opts.fixedInputTokens ?? estimateRequestTokens(messages, tools);
    },
  };
}

/** A ChatResult with plain text and no tool calls. */
export function textResult(content: string, tokensOut = 10): ChatResult {
  return { content, toolCalls: [], usage: { tokensIn: 20, tokensOut } };
}

/** A ChatResult asking to call a single tool. */
export function toolCallResult(
  name: string,
  args: Record<string, unknown>,
  id = "call-1",
): ChatResult {
  return {
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    usage: { tokensIn: 20, tokensOut: 5 },
  };
}

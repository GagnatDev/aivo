import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { logger } from "../logger.js";
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  LlmProvider,
  ToolCall,
  ToolSchema,
} from "./provider.js";
import { estimateRequestTokens } from "./tokens.js";

export interface OpenAiProviderOptions {
  apiKey: string;
  /** OpenAI-compatible endpoint base URL (e.g. Scaleway's generative API). */
  baseURL: string;
}

/** Map our provider-agnostic message to the OpenAI chat param shape. */
function toOpenAiMessage(m: ChatMessage): ChatCompletionMessageParam {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.content ?? "" };
    case "user":
      return { role: "user", content: m.content ?? "" };
    case "tool":
      return { role: "tool", tool_call_id: m.tool_call_id ?? "", content: m.content ?? "" };
    case "assistant":
      return {
        role: "assistant",
        content: m.content,
        ...(m.tool_calls?.length
          ? {
              tool_calls: m.tool_calls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
      };
  }
}

function toOpenAiTool(t: ToolSchema): ChatCompletionTool {
  return {
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

/**
 * The only file that imports the OpenAI SDK. Constructs a client pointed at
 * `baseURL` and adapts our `ChatRequest`/`ChatResult` to the chat-completions API.
 * Swapping providers or faking this in tests touches nothing else.
 */
export function createOpenAiProvider(opts: OpenAiProviderOptions): LlmProvider {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });

  return {
    async chat(req: ChatRequest): Promise<ChatResult> {
      const res = await client.chat.completions.create({
        model: req.model,
        messages: req.messages.map(toOpenAiMessage),
        ...(req.tools?.length
          ? { tools: req.tools.map(toOpenAiTool), tool_choice: "auto" as const }
          : {}),
        max_tokens: req.maxTokens,
      });

      const choice = res.choices[0];
      const rawToolCalls = choice?.message.tool_calls ?? [];
      const toolCalls: ToolCall[] = rawToolCalls
        .filter((tc): tc is typeof tc & { type: "function" } => tc.type === "function")
        .map((tc, index) => ({
          // Some OpenAI-compatible servers (e.g. vLLM-served Llama on Scaleway) return
          // tool calls without an `id`. An empty id breaks tool-result matching and
          // makes the model re-issue the same call forever, so synthesize a stable one.
          id: tc.id || `call_${index}`,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));

      // Log the raw response shape (finish_reason, how many tool_calls the provider
      // returned vs how many we kept after type-filtering) so provider-specific
      // tool-calling quirks are visible in dev.
      logger.debug(
        {
          model: req.model,
          finishReason: choice?.finish_reason,
          rawToolCalls: rawToolCalls.length,
          keptToolCalls: toolCalls.length,
          promptTokens: res.usage?.prompt_tokens,
          completionTokens: res.usage?.completion_tokens,
        },
        "llm response",
      );

      return {
        content: choice?.message.content ?? null,
        toolCalls,
        usage: {
          tokensIn: res.usage?.prompt_tokens ?? 0,
          tokensOut: res.usage?.completion_tokens ?? 0,
        },
      };
    },

    countTokens(messages: ChatMessage[], tools?: ToolSchema[]): number {
      return estimateRequestTokens(messages, tools);
    },
  };
}

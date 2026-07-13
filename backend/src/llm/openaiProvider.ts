import OpenAI, { toFile } from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { logger } from "../logger.js";
import { toLlmProviderError } from "./errors.js";
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  LlmProvider,
  ToolCall,
  ToolSchema,
  TranscriptionRequest,
  TranscriptionResult,
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
      // This is the only place that sees the SDK's error shapes, so it's where they get
      // classified into the taxonomy (auth/rate_limit/server/network); the agent then
      // reasons over `kind` rather than re-inspecting SDK internals.
      let res: OpenAI.Chat.Completions.ChatCompletion;
      try {
        res = await client.chat.completions.create({
          model: req.model,
          messages: req.messages.map(toOpenAiMessage),
          ...(req.tools?.length
            ? { tools: req.tools.map(toOpenAiTool), tool_choice: "auto" as const }
            : {}),
          max_tokens: req.maxTokens,
        });
      } catch (err) {
        throw toLlmProviderError(err);
      }

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

    async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
      try {
        // `toFile` wraps the in-memory buffer as the multipart upload the SDK expects;
        // the filename's extension + contentType tell the provider the audio format.
        const file = await toFile(req.audio, req.filename, { type: req.contentType });
        const res = await client.audio.transcriptions.create({ file, model: req.model });
        // Some OpenAI-compatible servers include a `duration` (seconds) in the response;
        // it's optional in the SDK types, so read it defensively — the caller falls back
        // to Discord's duration for cost metering when it's absent.
        const duration = (res as { duration?: number }).duration;
        return {
          text: res.text ?? "",
          ...(typeof duration === "number" ? { durationSeconds: duration } : {}),
        };
      } catch (err) {
        throw toLlmProviderError(err);
      }
    },
  };
}

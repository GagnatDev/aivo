import OpenAI, { toFile } from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { logger } from "../logger.js";
import { toLlmProviderError } from "./errors.js";
import { withLlmRetries } from "./retry.js";
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
  /**
   * Per-call timeout (ms). Replaces the SDK's silent 10-minute default with something
   * suited to chat UX — a wedged provider fails fast (as a `network` taxonomy error)
   * instead of holding the Discord typing indicator for minutes. `LLM_TIMEOUT_MS`.
   */
  timeoutMs: number;
  /**
   * Retries for transient failures (rate limit, 5xx, network), with exponential
   * backoff + jitter, honoring Retry-After (see retry.ts). Auth errors never retry.
   * `LLM_MAX_RETRIES`.
   */
  maxRetries: number;
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
  // maxRetries: 0 disables the SDK's implicit policy (2 silent retries) — retry.ts is
  // the single retry decision-maker, keyed on our error taxonomy; timeout replaces the
  // SDK's 10-minute default with an explicit chat-UX bound.
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    timeout: opts.timeoutMs,
    maxRetries: 0,
  });
  const retryOpts = { maxRetries: opts.maxRetries };

  return {
    async chat(req: ChatRequest): Promise<ChatResult> {
      // This is the only place that sees the SDK's error shapes, so it's where they get
      // classified into the taxonomy (auth/rate_limit/server/network); the agent then
      // reasons over `kind` rather than re-inspecting SDK internals. Classification
      // happens inside the retry wrapper so the policy can key on the taxonomy `kind`.
      const res = await withLlmRetries(async () => {
        try {
          return await client.chat.completions.create({
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
      }, retryOpts);

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
      // Same retry policy as chat — transcription is idempotent, so a transient
      // failure is safe to retry.
      const res = await withLlmRetries(async () => {
        try {
          // `toFile` wraps the in-memory buffer as the multipart upload the SDK expects;
          // the filename's extension + contentType tell the provider the audio format.
          const file = await toFile(req.audio, req.filename, { type: req.contentType });
          return await client.audio.transcriptions.create({ file, model: req.model });
        } catch (err) {
          throw toLlmProviderError(err);
        }
      }, retryOpts);
      // Some OpenAI-compatible servers include a `duration` (seconds) in the response;
      // it's optional in the SDK types, so read it defensively — the caller falls back
      // to Discord's duration for cost metering when it's absent.
      const duration = (res as { duration?: number }).duration;
      return {
        text: res.text ?? "",
        ...(typeof duration === "number" ? { durationSeconds: duration } : {}),
      };
    },
  };
}

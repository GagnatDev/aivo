import { logger } from "../logger.js";
import { LlmProviderError, ToolExecutionError } from "../llm/errors.js";
import type { ChatMessage, ChatResult, ToolCall, ToolSchema } from "../llm/provider.js";
import { recordUsageAndAlert } from "./budget.js";
import type { AgentDeps } from "./deps.js";
import type { AgentTool, ToolContext } from "./tools/index.js";

// The metering task type for chat turns — every usage row this loop records is tagged
// with it (kept in step with the approval gate's task type in prepareTurn.ts).
export const TASK_TYPE = "chat";
// Discord rejects empty message bodies, so never return "" to the caller.
const EMPTY_REPLY_FALLBACK = "I don't have anything to add to that.";
// Shown when the LLM provider call fails, chosen by the failure's taxonomy `kind` so
// the reply matches the cause instead of collapsing every failure to one string.
// server/network (transient outage) → retry hint; rate_limit → busy hint; auth
// (permanent, needs the owner) → point at the config.
const LLM_ERROR_FALLBACK =
  "Sorry — I couldn't reach the language model just now. Please try again in a moment.";
const LLM_RATE_LIMIT_FALLBACK =
  "Sorry — the language model is busy right now. Please try again in a moment.";
const LLM_AUTH_FALLBACK =
  "Sorry — I can't reach the language model because of a credentials problem. " +
  "The owner needs to check the API configuration.";
// Last-resort reply when even the tools-disabled final answer yields nothing.
const STUCK_FALLBACK = "I got a bit tangled working through that — can you rephrase?";

/** Pick the user-facing reply for a failed LLM call from its taxonomy `kind`. */
function llmErrorReply(err: unknown): string {
  if (err instanceof LlmProviderError) {
    switch (err.kind) {
      case "auth":
        return LLM_AUTH_FALLBACK;
      case "rate_limit":
        return LLM_RATE_LIMIT_FALLBACK;
      case "server":
      case "network":
        return LLM_ERROR_FALLBACK;
    }
  }
  return LLM_ERROR_FALLBACK;
}

export interface LoopParams {
  model: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  maxTokens: number;
}

export interface LoopResult {
  reply: string;
  alertPct?: number;
}

/**
 * The in-house tool-calling loop. Each model round-trip is metered; tool calls are
 * executed and their results fed back until the model returns a final text answer or
 * the iteration cap is hit (runaway backstop). Exported so both `runAgent` and the
 * approval-gate resume path can reuse it.
 */
export async function runToolLoop(
  deps: AgentDeps,
  ctx: ToolContext,
  registry: AgentTool[],
  params: LoopParams,
): Promise<LoopResult> {
  const messages = params.messages;
  let alertPct: number | undefined;
  // Signatures (name+args) of tool calls already executed this turn — used to detect
  // a model stuck re-issuing the same calls (a common open-model failure mode).
  const executed = new Set<string>();

  for (let i = 0; i < deps.config.agentMaxToolIterations; i++) {
    let result: ChatResult;
    try {
      result = await deps.llm.chat({
        model: params.model,
        messages,
        tools: params.tools,
        maxTokens: params.maxTokens,
      });
    } catch (err) {
      // Provider failure (auth/403, rate limit, outage). Surface a reply matched to the
      // cause rather than letting the turn throw and leave the user with no response.
      const kind = err instanceof LlmProviderError ? err.kind : "unknown";
      logger.error({ err, kind }, "llm chat call failed");
      return { reply: llmErrorReply(err), alertPct };
    }

    const record = await recordUsageAndAlert(
      deps,
      ctx.userId,
      TASK_TYPE,
      params.model,
      result.usage,
    );
    if (record.alertPct) alertPct = Math.max(alertPct ?? 0, record.alertPct);

    logger.debug(
      {
        userId: ctx.userId,
        iteration: i,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        toolCalls: result.toolCalls.map((c) => ({
          id: c.id,
          name: c.name,
          arguments: c.arguments,
        })),
        contentPreview: preview(result.content),
      },
      "agent llm round-trip",
    );

    if (result.toolCalls.length === 0) {
      logger.debug({ userId: ctx.userId, iterations: i + 1 }, "agent final reply");
      return { reply: (result.content ?? "").trim() || EMPTY_REPLY_FALLBACK, alertPct };
    }

    // Persist + replay the assistant message that requested the tools. The replayed
    // message keeps the model's real (often null) content + structured tool_calls; the
    // persisted row instead records what the turn actually did, since a bare null shows
    // up in the activity log as an empty "(no content recorded)" line.
    messages.push({ role: "assistant", content: result.content, tool_calls: result.toolCalls });
    await deps.messages.insert({
      conversationId: ctx.conversationId,
      role: "assistant",
      content: result.content?.trim() || describeToolCalls(result.toolCalls),
      discordMessageId: null,
    });

    let allRepeats = true;
    for (const call of result.toolCalls) {
      const signature = `${call.name}:${call.arguments}`;
      if (!executed.has(signature)) allRepeats = false;
      executed.add(signature);
      const toolResult = await executeToolCall(registry, call.name, call.arguments, ctx);
      logger.debug(
        {
          userId: ctx.userId,
          tool: call.name,
          arguments: call.arguments,
          resultPreview: preview(toolResult),
        },
        "agent tool executed",
      );
      await deps.messages.insert({
        conversationId: ctx.conversationId,
        role: "tool",
        content: toolResult,
        discordMessageId: null,
      });
      messages.push({ role: "tool", content: toolResult, tool_call_id: call.id, name: call.name });
    }

    // The model re-issued only tool calls it had already made this turn — it's stuck.
    // Stop looping and force a plain-text answer from what it already has.
    if (allRepeats) {
      logger.warn(
        { userId: ctx.userId, model: params.model, iteration: i },
        "agent repeated tool calls; forcing answer",
      );
      return forceFinalAnswer(deps, ctx, params, messages, alertPct);
    }
  }

  logger.warn(
    { userId: ctx.userId, model: params.model, iterations: deps.config.agentMaxToolIterations },
    "agent hit tool-iteration cap; forcing answer",
  );
  return forceFinalAnswer(deps, ctx, params, messages, alertPct);
}

/**
 * Make one final completion with tools disabled so the model must answer in plain
 * text from the context it already has. Used when the loop is stuck (repeated tool
 * calls) or hit the iteration cap, turning a dead-end into a useful reply. The nudge
 * is not persisted; the resulting text is returned for the caller to send + record.
 */
async function forceFinalAnswer(
  deps: AgentDeps,
  ctx: ToolContext,
  params: LoopParams,
  messages: ChatMessage[],
  alertPct: number | undefined,
): Promise<LoopResult> {
  const nudged: ChatMessage[] = [
    ...messages,
    {
      role: "system",
      content:
        "Answer the user now in plain text, using the information you already have. " +
        "Do not call any tools.",
    },
  ];
  try {
    const result = await deps.llm.chat({
      model: params.model,
      messages: nudged,
      maxTokens: params.maxTokens,
    });
    const record = await recordUsageAndAlert(
      deps,
      ctx.userId,
      TASK_TYPE,
      params.model,
      result.usage,
    );
    const nextAlert = record.alertPct ? Math.max(alertPct ?? 0, record.alertPct) : alertPct;
    const text = (result.content ?? "").trim();
    if (text) return { reply: text, alertPct: nextAlert };
    return { reply: STUCK_FALLBACK, alertPct: nextAlert };
  } catch (err) {
    logger.error(err, "forced final answer failed");
    return { reply: STUCK_FALLBACK, alertPct };
  }
}

/** Truncate a possibly-null string for log lines. */
function preview(text: string | null, max = 200): string {
  if (!text) return "(none)";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * A human-readable summary of the tools an assistant turn requested, persisted as the
 * message content when the model returned tool calls but no text of its own. Without it
 * the activity log renders these turns as an empty "(no content recorded)" line; with it
 * the log shows what actually happened — which tools ran, with a compact argument preview
 * (large payloads truncated so the thread stays readable).
 */
function describeToolCalls(toolCalls: ToolCall[]): string {
  if (toolCalls.length === 0) return "";
  const calls = toolCalls.map((c) => {
    const args = c.arguments?.trim();
    if (!args || args === "{}") return c.name;
    return `${c.name}(${preview(args, 120)})`;
  });
  return `Used ${calls.length === 1 ? "tool" : "tools"}: ${calls.join(", ")}`;
}

async function executeToolCall(
  registry: AgentTool[],
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<string> {
  const tool = registry.find((t) => t.schema.name === name);
  if (!tool) return `Unknown tool: ${name}`;
  let args: unknown = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return "Could not parse tool arguments as JSON.";
  }
  try {
    return await tool.execute(args, ctx);
  } catch (err) {
    // Wrap at the seam so the tool name and cause are captured as structured data, then
    // feed the failure back to the model (as a tool result) so it can recover, rather
    // than aborting the whole turn.
    const toolErr = new ToolExecutionError(name, { cause: err });
    logger.error({ err, tool: name }, toolErr.message);
    return `${toolErr.message}.`;
  }
}

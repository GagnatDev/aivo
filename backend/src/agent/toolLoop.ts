import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { logger } from "../logger.js";
import { LlmProviderError, ToolExecutionError } from "../llm/errors.js";
import type {
  ChatMessage,
  ChatResult,
  FinishReason,
  ToolCall,
  ToolSchema,
} from "../llm/provider.js";
import { truncateToTokens } from "../llm/tokens.js";
import { recordUsageAndAlert } from "./budget.js";
import type { AgentDeps } from "./deps.js";
import { RepeatTracker } from "./repeatDetection.js";
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
// Appended when the turn was stopped by the in-flight cost ceiling, so the user knows
// the answer may be partial and why (mirrors the truncation note's transparency).
const COST_CEILING_NOTE =
  "\n\n(I wrapped that up early — this turn was getting expensive. Ask again if you want me to dig deeper.)";
// Appended when the model's text was cut off by the output-token cap (finishReason
// `length`), so a truncated reply is never passed off as a complete one.
const TRUNCATION_NOTE = "\n\n(…that got cut off by my reply-length limit.)";
// Fed back as the tool result when a `length` stop truncated the tool call itself —
// its arguments JSON is almost certainly incomplete, so executing it would only yield
// a confusing parse error. Telling the model why lets it recover deliberately.
const TOOL_CALL_TRUNCATED_FEEDBACK =
  "Tool call not executed: it was cut off by the output token limit. " +
  "Make a shorter tool call (smaller arguments), or answer in plain text.";
// Persisted for every tool call left unexecuted when a turn is abandoned mid-round.
// Not cosmetic: an assistant row carrying tool_calls with no matching tool results
// replays as an invalid message list, so backfilling these is what keeps the
// conversation usable on the next turn.
const TOOL_CALL_CANCELLED_FEEDBACK = "Tool call not executed: the turn was cancelled.";
// Returned (not normally sent) when a turn is abandoned — see LoopResult.aborted.
const ABORTED_REPLY = "Stopped there.";

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
  /**
   * Whole-turn spend ceiling in fractional cents (see PreparedTurn.costCeilingCents);
   * null/undefined disables it. Checked against the turn's actual accumulated cost
   * before each round-trip, so the loop's total stays bounded even though the pre-call
   * approval gate only priced the first call.
   */
  costCeilingCents?: number | null;
  /**
   * Abandons the turn when it fires (graceful shutdown today; a user-facing "stop"
   * would use the same seam). Checked before each round-trip and before each tool
   * execution, and passed to the provider so an in-flight call is cancelled too.
   */
  signal?: AbortSignal;
}

export interface LoopResult {
  reply: string;
  alertPct?: number;
  /**
   * The turn was abandoned via {@link LoopParams.signal} rather than finished. The
   * caller should normally drop the reply instead of sending it — nobody asked for a
   * half-answer, and during shutdown the transport is going away anyway.
   */
  aborted?: boolean;
}

/** How a turn ended, for the per-turn observability record. */
export type TurnOutcome =
  | "final_answer"
  | "forced_answer"
  | "iteration_cap"
  | "cost_ceiling"
  | "provider_error"
  | "aborted";

/**
 * Running totals for one turn, accumulated across every model round-trip (including
 * the forced final answer) and emitted as a single info-level "agent turn completed"
 * line. Debug logging is rich but off in production; this record is what makes a
 * misbehaving turn ("why did that take 40 seconds / cost 12¢") diagnosable there.
 */
interface TurnStats {
  iterations: number;
  toolsCalled: string[];
  toolErrors: number;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  finishReasons: FinishReason[];
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
  // Every log line this turn emits carries the same turn id, so a turn's round-trips
  // can be correlated in production output without debug-level reconstruction.
  const log = logger.child({
    turnId: randomUUID(),
    userId: ctx.userId,
    conversationId: ctx.conversationId,
  });
  const startedAtMs = deps.clock.now().getTime();
  const stats: TurnStats = {
    iterations: 0,
    toolsCalled: [],
    toolErrors: 0,
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
    finishReasons: [],
  };
  // The one info-level record per turn — every exit path funnels through here.
  const finish = (outcome: TurnOutcome, result: LoopResult): LoopResult => {
    log.info(
      { ...stats, outcome, latencyMs: deps.clock.now().getTime() - startedAtMs },
      "agent turn completed",
    );
    return result;
  };

  const messages = params.messages;
  let alertPct: number | undefined;
  // Tracks calls already executed this turn (and what they returned) to detect a model
  // stuck re-issuing the same calls — see repeatDetection.ts for what counts as stuck.
  const repeats = new RepeatTracker();

  /** Abandon the turn: one info-level record, no reply sent by the caller. */
  const abort = (iteration: number): LoopResult => {
    log.info({ iteration }, "agent turn aborted");
    return finish("aborted", { reply: ABORTED_REPLY, alertPct, aborted: true });
  };

  for (let i = 0; i < deps.config.agentMaxToolIterations; i++) {
    // Cancellation is checked here first: everything below this line spends money or
    // time, and a turn abandoned between rounds leaves the persisted history complete.
    if (params.signal?.aborted) return abort(i);

    // In-flight cost ceiling: the approval gate priced only the first call's worst
    // case, so re-check the turn's ACTUAL accumulated cost before spending another
    // round-trip on the ever-growing context. Checked at the top of the iteration so
    // every continue-path (tool results fed back, truncated-call feedback) passes
    // through it. The forced answer is one final, tools-disabled call — the bounded
    // exit, same as the iteration cap.
    if (params.costCeilingCents != null && stats.costCents >= params.costCeilingCents) {
      log.warn(
        {
          model: params.model,
          iteration: i,
          costCents: stats.costCents,
          costCeilingCents: params.costCeilingCents,
        },
        "agent turn reached in-flight cost ceiling; forcing answer",
      );
      const forced = await forceFinalAnswer(deps, ctx, params, messages, alertPct, log, stats);
      return finish("cost_ceiling", { ...forced, reply: forced.reply + COST_CEILING_NOTE });
    }

    let result: ChatResult;
    try {
      result = await deps.llm.chat({
        model: params.model,
        messages,
        tools: params.tools,
        maxTokens: params.maxTokens,
        ...(params.signal ? { signal: params.signal } : {}),
      });
    } catch (err) {
      // Our own cancellation, not a provider failure — the call was aborted in flight.
      if (params.signal?.aborted) return abort(i);
      // Provider failure (auth/403, rate limit, outage). Surface a reply matched to the
      // cause rather than letting the turn throw and leave the user with no response.
      const kind = err instanceof LlmProviderError ? err.kind : "unknown";
      log.error({ err, kind }, "llm chat call failed");
      return finish("provider_error", { reply: llmErrorReply(err), alertPct });
    }

    const record = await recordUsageAndAlert(
      deps,
      ctx.userId,
      TASK_TYPE,
      params.model,
      result.usage,
    );
    if (record.alertPct) alertPct = Math.max(alertPct ?? 0, record.alertPct);
    stats.iterations = i + 1;
    stats.tokensIn += result.usage.tokensIn;
    stats.tokensOut += result.usage.tokensOut;
    stats.costCents += record.costCents;
    stats.finishReasons.push(result.finishReason);

    log.debug(
      {
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
      const text = (result.content ?? "").trim();
      // A `length` stop mid-text would otherwise be sent as if it were complete.
      if (result.finishReason === "length" && text) {
        log.warn(
          { model: params.model, maxTokens: params.maxTokens },
          "agent reply truncated by output token limit",
        );
        return finish("final_answer", { reply: text + TRUNCATION_NOTE, alertPct });
      }
      return finish("final_answer", { reply: text || EMPTY_REPLY_FALLBACK, alertPct });
    }

    // Replay the assistant message that requested the tools into THIS turn's context,
    // keeping the model's real (often null) content + structured tool_calls.
    messages.push({ role: "assistant", content: result.content, tool_calls: result.toolCalls });
    // Persist the same structured shape: an assistant row with its tool_calls JSON, so
    // buildContext can replay the exchange faithfully across turns. (This replaces the
    // old flattened "Used tool: …" audit summary, which lacked the tool_call linkage
    // and — when replayed as assistant text — taught the model to echo it to Discord;
    // the dashboard renders the calls from the structured column instead.)
    await deps.messages.insert({
      conversationId: ctx.conversationId,
      role: "assistant",
      content: result.content,
      toolCalls: result.toolCalls,
      discordMessageId: null,
    });

    // A `length` stop that still carries tool calls means the output cap cut the call
    // JSON off mid-generation. Executing it would just burn the iteration on a generic
    // "Could not parse tool arguments" — feed back the real cause instead so the model
    // can shorten the call (or answer). The iteration cap still bounds a model that
    // keeps overrunning.
    if (result.finishReason === "length") {
      log.warn(
        {
          model: params.model,
          iteration: i,
          maxTokens: params.maxTokens,
          toolCalls: result.toolCalls.map((c) => c.name),
        },
        "agent tool call truncated by output token limit; feeding back",
      );
      await answerToolCalls(deps, ctx, messages, result.toolCalls, TOOL_CALL_TRUNCATED_FEEDBACK);
      continue;
    }

    let allRepeats = true;
    for (const [index, call] of result.toolCalls.entries()) {
      // Cancelled between tools: don't start another one, but do answer the calls we're
      // walking away from, or the assistant row above would replay unanswered.
      if (params.signal?.aborted) {
        await answerToolCalls(
          deps,
          ctx,
          messages,
          result.toolCalls.slice(index),
          TOOL_CALL_CANCELLED_FEEDBACK,
        );
        return abort(i);
      }
      const execution = await executeToolCall(registry, call.name, call.arguments, ctx, log);
      stats.toolsCalled.push(call.name);
      if (execution.isError) stats.toolErrors += 1;
      // Cap oversized results at the loop boundary: a large result would otherwise be
      // re-sent verbatim on every subsequent iteration, inflating every round-trip. The
      // capped text is what the model sees AND what we persist, so replay (see #52) stays
      // faithful to — and as bounded as — what actually happened this turn.
      const toolResult = capToolResult(execution.text, deps.config.toolResultMaxTokens);
      // Judged on the capped text — that's what the model actually sees, so it's what
      // decides whether this call told it anything new.
      if (!repeats.record(call.name, call.arguments, toolResult)) allRepeats = false;
      log.debug(
        {
          tool: call.name,
          arguments: call.arguments,
          resultPreview: preview(toolResult),
          truncated: toolResult.length !== execution.text.length,
        },
        "agent tool executed",
      );
      await deps.messages.insert({
        conversationId: ctx.conversationId,
        role: "tool",
        content: toolResult,
        toolCallId: call.id,
        toolName: call.name,
        discordMessageId: null,
      });
      messages.push({ role: "tool", content: toolResult, tool_call_id: call.id, name: call.name });
    }

    // Every call in this round re-ran an earlier one and learned nothing new from it —
    // the model is stuck. Stop looping and force a plain-text answer from what it has.
    if (allRepeats) {
      log.warn({ model: params.model, iteration: i }, "agent repeated tool calls; forcing answer");
      return finish(
        "forced_answer",
        await forceFinalAnswer(deps, ctx, params, messages, alertPct, log, stats),
      );
    }
  }

  log.warn(
    { model: params.model, iterations: deps.config.agentMaxToolIterations },
    "agent hit tool-iteration cap; forcing answer",
  );
  return finish(
    "iteration_cap",
    await forceFinalAnswer(deps, ctx, params, messages, alertPct, log, stats),
  );
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
  log: Logger,
  stats: TurnStats,
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
      ...(params.signal ? { signal: params.signal } : {}),
    });
    const record = await recordUsageAndAlert(
      deps,
      ctx.userId,
      TASK_TYPE,
      params.model,
      result.usage,
    );
    // The forced call is a real round-trip of the same turn — fold it into the record.
    stats.tokensIn += result.usage.tokensIn;
    stats.tokensOut += result.usage.tokensOut;
    stats.costCents += record.costCents;
    stats.finishReasons.push(result.finishReason);
    const nextAlert = record.alertPct ? Math.max(alertPct ?? 0, record.alertPct) : alertPct;
    const text = (result.content ?? "").trim();
    if (text) {
      // The forced answer can be length-truncated too — flag it the same way.
      const reply = result.finishReason === "length" ? text + TRUNCATION_NOTE : text;
      return { reply, alertPct: nextAlert };
    }
    return { reply: STUCK_FALLBACK, alertPct: nextAlert };
  } catch (err) {
    log.error(err, "forced final answer failed");
    return { reply: STUCK_FALLBACK, alertPct };
  }
}

/**
 * Answer `calls` with a fixed explanation instead of executing them — used when the
 * calls arrived truncated, and when a turn is abandoned mid-round. Every tool call the
 * model makes must get a result, both in the replayed context and in the persisted
 * history, or the next turn's message list is invalid.
 */
async function answerToolCalls(
  deps: AgentDeps,
  ctx: ToolContext,
  messages: ChatMessage[],
  calls: ToolCall[],
  text: string,
): Promise<void> {
  for (const call of calls) {
    await deps.messages.insert({
      conversationId: ctx.conversationId,
      role: "tool",
      content: text,
      toolCallId: call.id,
      toolName: call.name,
      discordMessageId: null,
    });
    messages.push({ role: "tool", content: text, tool_call_id: call.id, name: call.name });
  }
}

/**
 * Bound a single tool result to `maxTokens`, appending a notice when it had to be cut so
 * the model knows the result is partial and how to get the rest (narrow the query) rather
 * than treating the truncated text as the whole answer. A cap of 0 disables the bound.
 */
function capToolResult(result: string, maxTokens: number): string {
  if (maxTokens <= 0) return result;
  const { text, truncated } = truncateToTokens(result, maxTokens);
  if (!truncated) return result;
  return (
    `${text}\n\n[Tool result truncated: it exceeded the ${maxTokens}-token cap. ` +
    "Narrow the request (a search term, a specific item, or a smaller range) to see the rest.]"
  );
}

/** Truncate a possibly-null string for log lines. */
function preview(text: string | null, max = 200): string {
  if (!text) return "(none)";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** A tool call's outcome: the text fed back to the model, and whether it was a failure
 * (unknown tool, unparseable arguments, or the execute function throwing) — the error
 * flag feeds the turn record's `toolErrors` count. */
async function executeToolCall(
  registry: AgentTool[],
  name: string,
  rawArgs: string,
  ctx: ToolContext,
  log: Logger,
): Promise<{ text: string; isError: boolean }> {
  const tool = registry.find((t) => t.schema.name === name);
  if (!tool) return { text: `Unknown tool: ${name}`, isError: true };
  let args: unknown = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { text: "Could not parse tool arguments as JSON.", isError: true };
  }
  try {
    return { text: await tool.execute(args, ctx), isError: false };
  } catch (err) {
    // Wrap at the seam so the tool name and cause are captured as structured data, then
    // feed the failure back to the model (as a tool result) so it can recover, rather
    // than aborting the whole turn.
    const toolErr = new ToolExecutionError(name, { cause: err });
    log.error({ err, tool: name }, toolErr.message);
    return { text: `${toolErr.message}.`, isError: true };
  }
}

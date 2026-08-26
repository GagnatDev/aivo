import { describe, expect, it } from "vitest";
import { ConversationRepository } from "./conversationRepository.js";
import { MessageRepository } from "./messageRepository.js";
import { TurnSummaryRepository } from "./turnSummaryRepository.js";
import { UserRepository } from "./userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const conversations = new ConversationRepository(db);
  const messages = new MessageRepository(db);
  const turnSummaries = new TurnSummaryRepository(db);
  const user = await new UserRepository(db).upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: false,
  });
  const conversation = await conversations.getOrCreate(user.id, "chat", "chan-1");
  return { messages, turnSummaries, userId: user.id, conversationId: conversation.id };
}

const TURN = {
  turnId: "11111111-1111-4111-8111-111111111111",
  outcome: "final_answer" as const,
  iterations: 2,
  toolsCalled: ["memory", "weather"],
  toolErrors: 1,
  tokensIn: 40,
  tokensOut: 15,
  costCents: 1.2345,
  latencyMs: 1234,
  finishReasons: ["tool_calls", "stop"] as const,
};

describe("TurnSummaryRepository.insert", () => {
  it("round-trips a turn record, parsing fractional cents back to a number", async () => {
    const { turnSummaries, userId, conversationId } = await setup();

    const row = await turnSummaries.insert({
      ...TURN,
      conversationId,
      userId,
      finishReasons: [...TURN.finishReasons],
    });

    expect(row).toMatchObject({
      turn_id: TURN.turnId,
      conversation_id: conversationId,
      user_id: userId,
      outcome: "final_answer",
      iterations: 2,
      tools_called: ["memory", "weather"],
      tool_errors: 1,
      tokens_in: 40,
      tokens_out: 15,
      latency_ms: 1234,
      finish_reasons: ["tool_calls", "stop"],
    });
    // numeric comes back from node-pg as a string; the repository parses at the boundary.
    expect(row.cost_cents).toBe(1.2345);
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it("stores an empty tool list as an empty array, not null", async () => {
    const { turnSummaries, userId, conversationId } = await setup();

    const row = await turnSummaries.insert({
      ...TURN,
      conversationId,
      userId,
      toolsCalled: [],
      finishReasons: [],
    });

    expect(row.tools_called).toEqual([]);
    expect(row.finish_reasons).toEqual([]);
  });
});

describe("TurnSummaryRepository.listForWindow", () => {
  /** Insert a message then the turn record that closes the turn it belongs to. */
  async function turnWithMessage(
    ctx: Awaited<ReturnType<typeof setup>>,
    content: string,
    outcome: (typeof TURN)["outcome"] | "iteration_cap",
  ) {
    const message = await ctx.messages.insert({
      conversationId: ctx.conversationId,
      role: "user",
      content,
    });
    const turn = await ctx.turnSummaries.insert({
      ...TURN,
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      outcome,
      finishReasons: [...TURN.finishReasons],
    });
    return { message, turn };
  }

  it("returns the records at or after `since`, oldest first", async () => {
    const ctx = await setup();
    const first = await turnWithMessage(ctx, "one", "final_answer");
    const second = await turnWithMessage(ctx, "two", "iteration_cap");

    const window = await ctx.turnSummaries.listForWindow(ctx.conversationId, {
      since: second.message.created_at,
    });

    expect(window.map((t) => t.id)).toEqual([second.turn.id]);
    expect(window[0]?.outcome).toBe("iteration_cap");

    const all = await ctx.turnSummaries.listForWindow(ctx.conversationId, {
      since: first.message.created_at,
    });
    expect(all.map((t) => t.id)).toEqual([first.turn.id, second.turn.id]);
  });

  it("excludes records at or after the `before` message anchor, so pages stay disjoint", async () => {
    const ctx = await setup();
    const first = await turnWithMessage(ctx, "one", "final_answer");
    const second = await turnWithMessage(ctx, "two", "final_answer");

    // The older page: anchored on the newer page's oldest message.
    const older = await ctx.turnSummaries.listForWindow(ctx.conversationId, {
      since: first.message.created_at,
      beforeMessageId: second.message.id,
    });
    expect(older.map((t) => t.id)).toEqual([first.turn.id]);
  });

  it("never returns another conversation's records", async () => {
    const ctx = await setup();
    const other = await new ConversationRepository(testDb()).getOrCreate(
      ctx.userId,
      "youtube",
      "chan-2",
    );
    const mine = await turnWithMessage(ctx, "one", "final_answer");
    await ctx.turnSummaries.insert({
      ...TURN,
      conversationId: other.id,
      userId: ctx.userId,
      finishReasons: [...TURN.finishReasons],
    });

    const window = await ctx.turnSummaries.listForWindow(ctx.conversationId, {
      since: mine.message.created_at,
    });
    expect(window.map((t) => t.id)).toEqual([mine.turn.id]);
  });
});

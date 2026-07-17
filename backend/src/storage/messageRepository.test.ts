import { describe, expect, it } from "vitest";
import { ConversationRepository } from "./conversationRepository.js";
import { MessageRepository } from "./messageRepository.js";
import { UserRepository } from "./userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const conversations = new ConversationRepository(db);
  const messages = new MessageRepository(db);
  const user = await new UserRepository(db).upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: false,
  });
  return { conversations, messages, userId: user.id };
}

describe("MessageRepository.getLatestDiscordMessageId", () => {
  it("returns null when nothing is recorded", async () => {
    const { messages } = await setup();
    expect(await messages.getLatestDiscordMessageId()).toBeNull();
  });

  it("returns the highest snowflake across all channels, by id not insertion order", async () => {
    const { conversations, messages, userId } = await setup();
    const chat = await conversations.getOrCreate(userId, "chat", "chan-1");
    const yt = await conversations.getOrCreate(userId, "youtube", "chan-2");
    // Insert out of snowflake order to prove ordering is by id, not insertion time.
    await messages.insert({
      conversationId: chat.id,
      role: "user",
      content: "a",
      discordMessageId: "100",
    });
    await messages.insert({
      conversationId: yt.id,
      role: "user",
      content: "b",
      discordMessageId: "305",
    });
    await messages.insert({
      conversationId: chat.id,
      role: "user",
      content: "c",
      discordMessageId: "207",
    });
    expect(await messages.getLatestDiscordMessageId()).toBe("305");
  });

  it("ignores messages with no discord id", async () => {
    const { conversations, messages, userId } = await setup();
    const convo = await conversations.getOrCreate(userId, "chat", "chan-1");
    await messages.insert({
      conversationId: convo.id,
      role: "user",
      content: "a",
      discordMessageId: "100",
    });
    await messages.insert({
      conversationId: convo.id,
      role: "system",
      content: "note",
      discordMessageId: null,
    });
    expect(await messages.getLatestDiscordMessageId()).toBe("100");
  });
});

describe("MessageRepository.insert (structured tool turns)", () => {
  it("round-trips tool_calls as parsed JSON and the tool_call_id/name linkage", async () => {
    const { conversations, messages, userId } = await setup();
    const convo = await conversations.getOrCreate(userId, "chat", "chan-1");

    const assistant = await messages.insert({
      conversationId: convo.id,
      role: "assistant",
      content: null,
      toolCalls: [{ id: "call-1", name: "reminder", arguments: '{"action":"list"}' }],
    });
    // node-pg returns JSONB already parsed — no JSON.parse at the call site.
    expect(assistant.tool_calls).toEqual([
      { id: "call-1", name: "reminder", arguments: '{"action":"list"}' },
    ]);
    expect(assistant.tool_call_id).toBeNull();

    const result = await messages.insert({
      conversationId: convo.id,
      role: "tool",
      content: "no reminders",
      toolCallId: "call-1",
      toolName: "reminder",
    });
    expect(result.tool_call_id).toBe("call-1");
    expect(result.tool_name).toBe("reminder");
    expect(result.tool_calls).toBeNull();
  });

  it("leaves all tool columns null for an ordinary message", async () => {
    const { conversations, messages, userId } = await setup();
    const convo = await conversations.getOrCreate(userId, "chat", "chan-1");
    const row = await messages.insert({ conversationId: convo.id, role: "user", content: "hi" });
    expect(row.tool_calls).toBeNull();
    expect(row.tool_call_id).toBeNull();
    expect(row.tool_name).toBeNull();
  });
});

describe("MessageRepository.listPage", () => {
  // gen_random_uuid() ids + microsecond created_at mean a fast insert loop can leave
  // several rows in the same millisecond, where the (created_at, id) keyset the repo
  // paginates on would tie-break on a *random* uuid — nondeterministic, and a JS Date
  // (millisecond precision) can't even reconstruct the DB's microsecond order to
  // predict it. Stamp strictly increasing created_at (1s apart) so render order is
  // unambiguous. Returns the rows oldest-first with their new timestamps.
  async function stampAscendingCreatedAt(rows: Awaited<ReturnType<MessageRepository["insert"]>>[]) {
    const base = Date.parse("2024-01-01T00:00:00.000Z");
    const stamped = [];
    for (const [i, row] of rows.entries()) {
      const created_at = new Date(base + i * 1000);
      await testDb().updateTable("messages").set({ created_at }).where("id", "=", row.id).execute();
      stamped.push({ ...row, created_at });
    }
    return stamped;
  }

  it("returns the newest window oldest-first and pages backwards with `before`", async () => {
    const { conversations, messages, userId } = await setup();
    const convo = await conversations.getOrCreate(userId, "chat", "chan-1");
    const inserted = [];
    for (const content of ["m1", "m2", "m3", "m4", "m5"]) {
      inserted.push(await messages.insert({ conversationId: convo.id, role: "user", content }));
    }
    const ordered = await stampAscendingCreatedAt(inserted);

    const newest = await messages.listPage(convo.id, { limit: 2 });
    expect(newest.hasMore).toBe(true);
    expect(newest.messages.map((m) => m.id)).toEqual(ordered.slice(3).map((m) => m.id));

    const middle = await messages.listPage(convo.id, {
      limit: 2,
      before: newest.messages[0].id,
    });
    expect(middle.hasMore).toBe(true);
    expect(middle.messages.map((m) => m.id)).toEqual(ordered.slice(1, 3).map((m) => m.id));

    const oldest = await messages.listPage(convo.id, {
      limit: 2,
      before: middle.messages[0].id,
    });
    expect(oldest.hasMore).toBe(false);
    expect(oldest.messages.map((m) => m.id)).toEqual(ordered.slice(0, 1).map((m) => m.id));
  });

  it("reports hasMore=false when the whole thread fits one page", async () => {
    const { conversations, messages, userId } = await setup();
    const convo = await conversations.getOrCreate(userId, "chat", "chan-1");
    await messages.insert({ conversationId: convo.id, role: "user", content: "hello" });
    const page = await messages.listPage(convo.id, { limit: 50 });
    expect(page.hasMore).toBe(false);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].created_at).toBeInstanceOf(Date);
  });

  it("returns nothing for a `before` anchor from a different conversation", async () => {
    const { conversations, messages, userId } = await setup();
    const chat = await conversations.getOrCreate(userId, "chat", "chan-1");
    const yt = await conversations.getOrCreate(userId, "youtube", "chan-2");
    const foreign = await messages.insert({ conversationId: yt.id, role: "user", content: "x" });
    await messages.insert({ conversationId: chat.id, role: "user", content: "y" });
    const page = await messages.listPage(chat.id, { limit: 10, before: foreign.id });
    expect(page).toEqual({ messages: [], hasMore: false });
  });
});

describe("MessageRepository.existsByDiscordMessageId", () => {
  it("is false for an unseen id and true once recorded", async () => {
    const { conversations, messages, userId } = await setup();
    const convo = await conversations.getOrCreate(userId, "chat", "chan-1");
    expect(await messages.existsByDiscordMessageId("777")).toBe(false);
    await messages.insert({
      conversationId: convo.id,
      role: "user",
      content: "a",
      discordMessageId: "777",
    });
    expect(await messages.existsByDiscordMessageId("777")).toBe(true);
  });
});

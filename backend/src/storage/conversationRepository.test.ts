import { describe, expect, it } from "vitest";
import { ConversationRepository } from "./conversationRepository.js";
import { UserRepository } from "./userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function makeUser(discordUserId: string): Promise<string> {
  const row = await new UserRepository(testDb()).upsertByDiscordId({
    discordUserId,
    displayName: null,
    isOwner: false,
  });
  return row.id;
}

describe("ConversationRepository.getOrCreate", () => {
  it("creates a conversation on first use", async () => {
    const userId = await makeUser("u1");
    const convos = new ConversationRepository(testDb());
    const row = await convos.getOrCreate(userId, "chat", "chan-1");
    expect(row.user_id).toBe(userId);
    expect(row.channel).toBe("chat");
    expect(row.discord_channel_id).toBe("chan-1");
  });

  it("is idempotent per (user, channel)", async () => {
    const userId = await makeUser("u2");
    const convos = new ConversationRepository(testDb());
    const first = await convos.getOrCreate(userId, "chat", "chan-1");
    const second = await convos.getOrCreate(userId, "chat", "chan-1");
    expect(second.id).toBe(first.id);
  });

  it("keeps separate conversations per channel", async () => {
    const userId = await makeUser("u3");
    const convos = new ConversationRepository(testDb());
    const chat = await convos.getOrCreate(userId, "chat", "chan-1");
    const youtube = await convos.getOrCreate(userId, "youtube", "chan-2");
    expect(chat.id).not.toBe(youtube.id);
  });
});

describe("ConversationRepository dashboard reads", () => {
  it("listForUser orders by last activity, most recent first, scoped by user", async () => {
    const userId = await makeUser("u1");
    const otherId = await makeUser("u2");
    const convos = new ConversationRepository(testDb());
    const chat = await convos.getOrCreate(userId, "chat", "chan-1");
    const youtube = await convos.getOrCreate(userId, "youtube", "chan-2");
    await convos.getOrCreate(otherId, "chat", "chan-9");
    // A new message in #chat bumps last_message_at past the younger youtube lane.
    await convos.getOrCreate(userId, "chat", "chan-1");
    const listed = await convos.listForUser(userId);
    expect(listed.map((c) => c.id)).toEqual([chat.id, youtube.id]);
    expect(listed[0].last_message_at.getTime()).toBeGreaterThanOrEqual(
      listed[1].last_message_at.getTime(),
    );
  });

  it("findByIdForUser never returns another user's conversation", async () => {
    const userId = await makeUser("u1");
    const otherId = await makeUser("u2");
    const convos = new ConversationRepository(testDb());
    const chat = await convos.getOrCreate(userId, "chat", "chan-1");
    expect((await convos.findByIdForUser(chat.id, userId))?.id).toBe(chat.id);
    expect(await convos.findByIdForUser(chat.id, otherId)).toBeUndefined();
  });
});

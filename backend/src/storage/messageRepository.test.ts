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
    await messages.insert({ conversationId: chat.id, role: "user", content: "a", discordMessageId: "100" });
    await messages.insert({ conversationId: yt.id, role: "user", content: "b", discordMessageId: "305" });
    await messages.insert({ conversationId: chat.id, role: "user", content: "c", discordMessageId: "207" });
    expect(await messages.getLatestDiscordMessageId()).toBe("305");
  });

  it("ignores messages with no discord id", async () => {
    const { conversations, messages, userId } = await setup();
    const convo = await conversations.getOrCreate(userId, "chat", "chan-1");
    await messages.insert({ conversationId: convo.id, role: "user", content: "a", discordMessageId: "100" });
    await messages.insert({ conversationId: convo.id, role: "system", content: "note", discordMessageId: null });
    expect(await messages.getLatestDiscordMessageId()).toBe("100");
  });
});

describe("MessageRepository.existsByDiscordMessageId", () => {
  it("is false for an unseen id and true once recorded", async () => {
    const { conversations, messages, userId } = await setup();
    const convo = await conversations.getOrCreate(userId, "chat", "chan-1");
    expect(await messages.existsByDiscordMessageId("777")).toBe(false);
    await messages.insert({ conversationId: convo.id, role: "user", content: "a", discordMessageId: "777" });
    expect(await messages.existsByDiscordMessageId("777")).toBe(true);
  });
});

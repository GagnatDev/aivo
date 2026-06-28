import { describe, expect, it } from "vitest";
import {
  buildReply,
  handleIncomingMessage,
  recordAssistantReply,
  type HandleMessageDeps,
  type IncomingMessage,
} from "./handleMessage.js";
import { ConversationRepository } from "../storage/conversationRepository.js";
import { MessageRepository } from "../storage/messageRepository.js";
import { UserRepository } from "../storage/userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

const OWNER_ID = "owner-123";

function makeDeps(): HandleMessageDeps {
  const db = testDb();
  return {
    users: new UserRepository(db),
    conversations: new ConversationRepository(db),
    messages: new MessageRepository(db),
    ownerDiscordUserId: OWNER_ID,
  };
}

const incoming = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  id: "msg-1",
  authorId: OWNER_ID,
  authorDisplayName: "Ann",
  channelId: "chan-1",
  content: "hello there",
  ...over,
});

describe("buildReply", () => {
  it("echoes the received text in a deterministic stub", () => {
    expect(buildReply("hi")).toBe('🏓 pong — you said: "hi"');
  });
});

describe("handleIncomingMessage", () => {
  it("JIT-provisions the owner, opens a chat conversation, stores the inbound message", async () => {
    const deps = makeDeps();
    const result = await handleIncomingMessage(deps, incoming());

    expect(result.reply).toBe('🏓 pong — you said: "hello there"');

    const user = await deps.users.findByDiscordId(OWNER_ID);
    expect(user?.is_owner).toBe(true);

    const stored = await deps.messages.listByConversation(result.conversationId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.role).toBe("user");
    expect(stored[0]?.content).toBe("hello there");
    expect(stored[0]?.discord_message_id).toBe("msg-1");
  });

  it("flags non-owner authors as is_owner=false", async () => {
    const deps = makeDeps();
    await handleIncomingMessage(deps, incoming({ authorId: "someone-else" }));
    const user = await deps.users.findByDiscordId("someone-else");
    expect(user?.is_owner).toBe(false);
  });

  it("records the assistant reply with its discord message id (full round-trip)", async () => {
    const deps = makeDeps();
    const result = await handleIncomingMessage(deps, incoming());
    await recordAssistantReply(deps, result.conversationId, result.reply, "reply-99");

    const stored = await deps.messages.listByConversation(result.conversationId);
    expect(stored.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(stored[1]?.discord_message_id).toBe("reply-99");
    expect(stored[1]?.content).toBe(result.reply);
  });

  it("reuses one conversation across multiple messages from the same user", async () => {
    const deps = makeDeps();
    const a = await handleIncomingMessage(deps, incoming({ id: "m1", content: "one" }));
    const b = await handleIncomingMessage(deps, incoming({ id: "m2", content: "two" }));
    expect(b.conversationId).toBe(a.conversationId);
    const stored = await deps.messages.listByConversation(a.conversationId);
    expect(stored).toHaveLength(2);
  });
});

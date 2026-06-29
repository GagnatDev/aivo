import { describe, expect, it } from "vitest";
import {
  handleIncomingMessage,
  recordAssistantReply,
  type HandleMessageDeps,
  type IncomingMessage,
} from "./handleMessage.js";
import { makeFakeLlm, textResult } from "../test/fakeLlm.js";
import { makeAgentDeps, OWNER_ID } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";

useCleanDb();

/** Build deps whose fake LLM replies with the given texts, one per agent turn. */
function makeDeps(replies: string[]): HandleMessageDeps {
  return makeAgentDeps(makeFakeLlm(replies.map((r) => textResult(r))));
}

const incoming = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  id: "msg-1",
  authorId: OWNER_ID,
  authorDisplayName: "Ann",
  channelId: "chan-1",
  content: "hello there",
  ...over,
});

describe("handleIncomingMessage", () => {
  it("JIT-provisions the owner, opens a chat conversation, stores the inbound message, and returns the agent reply", async () => {
    const deps = makeDeps(["Hi — what can I do for you?"]);
    const result = await handleIncomingMessage(deps, incoming());

    expect(result.reply).toBe("Hi — what can I do for you?");

    const user = await deps.users.findByDiscordId(OWNER_ID);
    expect(user?.is_owner).toBe(true);

    const stored = await deps.messages.listByConversation(result.conversationId);
    expect(stored[0]?.role).toBe("user");
    expect(stored[0]?.content).toBe("hello there");
    expect(stored[0]?.discord_message_id).toBe("msg-1");
  });

  it("flags non-owner authors as is_owner=false", async () => {
    const deps = makeDeps(["ok"]);
    await handleIncomingMessage(deps, incoming({ authorId: "someone-else" }));
    const user = await deps.users.findByDiscordId("someone-else");
    expect(user?.is_owner).toBe(false);
  });

  it("records the assistant reply with its discord message id (full round-trip)", async () => {
    const deps = makeDeps(["the answer"]);
    const result = await handleIncomingMessage(deps, incoming());
    await recordAssistantReply(deps, result.conversationId, result.reply, "reply-99");

    const stored = await deps.messages.listByConversation(result.conversationId);
    const assistant = stored.filter((m) => m.role === "assistant");
    expect(assistant.at(-1)?.discord_message_id).toBe("reply-99");
    expect(assistant.at(-1)?.content).toBe(result.reply);
  });

  it("reuses one conversation across multiple messages from the same user", async () => {
    const deps = makeDeps(["one-reply", "two-reply"]);
    const a = await handleIncomingMessage(deps, incoming({ id: "m1", content: "one" }));
    const b = await handleIncomingMessage(deps, incoming({ id: "m2", content: "two" }));
    expect(b.conversationId).toBe(a.conversationId);
    const stored = await deps.messages.listByConversation(a.conversationId);
    expect(stored.filter((m) => m.role === "user")).toHaveLength(2);
  });
});

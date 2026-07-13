import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleIncomingMessage,
  recordAssistantReply,
  type HandleMessageDeps,
  type IncomingMessage,
} from "./handleMessage.js";
import { makeFakeLlm, textResult } from "../test/fakeLlm.js";
import { makeAgentDeps, OWNER_ID } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";
import type { TranscriptionResult } from "../llm/provider.js";

useCleanDb();

/** Build deps whose fake LLM replies with the given texts, one per agent turn. */
function makeDeps(replies: string[]): HandleMessageDeps {
  return makeAgentDeps(makeFakeLlm(replies.map((r) => textResult(r))));
}

/** Deps whose fake LLM also transcribes voice messages to `transcript`. */
function makeVoiceDeps(
  replies: string[],
  transcript: TranscriptionResult | Error,
): HandleMessageDeps {
  return makeAgentDeps(
    makeFakeLlm(
      replies.map((r) => textResult(r)),
      { transcript },
    ),
  );
}

/** A voice attachment; the transcription downloader uses the global fetch stubbed below. */
const voiceAttachment = {
  url: "https://cdn.example/voice.ogg",
  contentType: "audio/ogg",
  durationSecs: 8,
  sizeBytes: 40_000,
  filename: "voice-message.ogg",
};

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

describe("handleIncomingMessage — voice messages", () => {
  beforeEach(() => {
    // The transcription downloader uses the global fetch; return dummy audio bytes.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("transcribes a voice message and runs the agent on the transcript", async () => {
    const deps = makeVoiceDeps(["Got it — noon tomorrow."], { text: "remind me at noon tomorrow" });
    const result = await handleIncomingMessage(
      deps,
      incoming({ content: "", voice: voiceAttachment }),
    );

    expect(result.reply).toBe("Got it — noon tomorrow.");
    const stored = await deps.messages.listByConversation(result.conversationId);
    // The persisted user turn is the transcript, marked as spoken.
    expect(stored[0]?.role).toBe("user");
    expect(stored[0]?.content).toContain("remind me at noon tomorrow");
    expect(stored[0]?.content).toMatch(/voice message/i);
    // An stt cost row was metered against the owner.
    const owner = await deps.users.findByDiscordId(OWNER_ID);
    expect(await deps.llmUsage.monthToDateCents(owner!.id)).toBeGreaterThan(0);
  });

  it("rejects an over-long voice message without running the agent", async () => {
    const deps = makeVoiceDeps(["should not be used"], { text: "unused" });
    const result = await handleIncomingMessage(
      deps,
      incoming({
        content: "",
        voice: { ...voiceAttachment, durationSecs: deps.config.voiceMaxDurationSecs + 5 },
      }),
    );

    expect(result.reply).toMatch(/voice note is a bit long/i);
    const stored = await deps.messages.listByConversation(result.conversationId);
    // Only the placeholder inbound is stored; no assistant/agent turn ran.
    expect(stored).toHaveLength(1);
    expect(stored[0]?.content).toMatch(/voice message/i);
  });

  it("replies gracefully when transcription is unavailable", async () => {
    const deps = makeVoiceDeps(["should not be used"], new Error("stt down"));
    const result = await handleIncomingMessage(
      deps,
      incoming({ content: "", voice: voiceAttachment }),
    );
    expect(result.reply).toMatch(/couldn't make out/i);
    const stored = await deps.messages.listByConversation(result.conversationId);
    expect(stored).toHaveLength(1);
  });
});

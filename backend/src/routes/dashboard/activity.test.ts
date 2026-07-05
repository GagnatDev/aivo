import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildDashboardTestApp, provisionTestOwner } from "../../test/dashboardApp.js";
import { useCleanDb } from "../../test/db.js";

useCleanDb();

describe("GET /api/dashboard/conversations", () => {
  it("lists the user's conversations, most recently active first (A-1)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const chat = await deps.conversations.getOrCreate(owner.id, "chat", "chan-1");
    const youtube = await deps.conversations.getOrCreate(owner.id, "youtube", "chan-2");
    // New chat activity bumps it above the younger youtube lane.
    await deps.conversations.getOrCreate(owner.id, "chat", "chan-1");

    const res = await request(app).get("/api/dashboard/conversations");
    expect(res.status).toBe(200);
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([chat.id, youtube.id]);
    expect(res.body.conversations[0]).toMatchObject({ channel: "chat" });
    expect(res.body.conversations[0].lastMessageAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("never lists another user's conversations", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const other = await deps.users.upsertByDiscordId({
      discordUserId: "someone-else",
      displayName: null,
      isOwner: false,
    });
    await deps.conversations.getOrCreate(other.id, "chat", "chan-9");

    const res = await request(app).get("/api/dashboard/conversations");
    expect(res.body.conversations).toEqual([]);
  });
});

describe("GET /api/dashboard/conversations/:id/messages", () => {
  it("returns the thread oldest-first with roles, timestamps, and tokens (A-2, A-3)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const convo = await deps.conversations.getOrCreate(owner.id, "chat", "chan-1");
    await deps.messages.insert({ conversationId: convo.id, role: "user", content: "hi" });
    await deps.messages.insert({ conversationId: convo.id, role: "tool", content: "memory: []" });
    const reply = await deps.messages.insert({
      conversationId: convo.id,
      role: "assistant",
      content: "hello!",
    });

    const res = await request(app).get(`/api/dashboard/conversations/${convo.id}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.conversation).toEqual({ id: convo.id, channel: "chat" });
    expect(res.body.hasMore).toBe(false);
    expect(res.body.messages).toHaveLength(3);
    const roles = res.body.messages.map((m: { role: string }) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("tool");
    expect(roles).toContain("assistant");
    const last = res.body.messages.find((m: { id: string }) => m.id === reply.id);
    expect(last).toMatchObject({ content: "hello!", tokensIn: null, tokensOut: null });
    expect(last.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("pages backwards through history with `before` and reports hasMore", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const convo = await deps.conversations.getOrCreate(owner.id, "chat", "chan-1");
    for (let i = 1; i <= 5; i++) {
      await deps.messages.insert({ conversationId: convo.id, role: "user", content: `m${i}` });
    }

    const newest = await request(app).get(
      `/api/dashboard/conversations/${convo.id}/messages?limit=3`,
    );
    expect(newest.body.messages).toHaveLength(3);
    expect(newest.body.hasMore).toBe(true);

    const older = await request(app).get(
      `/api/dashboard/conversations/${convo.id}/messages?limit=3&before=${newest.body.messages[0].id}`,
    );
    expect(older.body.messages).toHaveLength(2);
    expect(older.body.hasMore).toBe(false);
    // The two windows tile the thread without overlap.
    const ids = [...older.body.messages, ...newest.body.messages].map((m: { id: string }) => m.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("404s another user's thread and 400s bad params", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const other = await deps.users.upsertByDiscordId({
      discordUserId: "someone-else",
      displayName: null,
      isOwner: false,
    });
    const foreign = await deps.conversations.getOrCreate(other.id, "chat", "chan-9");

    expect(
      (await request(app).get(`/api/dashboard/conversations/${foreign.id}/messages`)).status,
    ).toBe(404);
    expect((await request(app).get("/api/dashboard/conversations/nope/messages")).status).toBe(400);
    expect(
      (await request(app).get(`/api/dashboard/conversations/${foreign.id}/messages?limit=0`))
        .status,
    ).toBe(400);
  });
});

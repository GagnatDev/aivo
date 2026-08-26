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

  it("returns the turn records covering the page, oldest first (A-6)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const convo = await deps.conversations.getOrCreate(owner.id, "chat", "chan-1");
    await deps.messages.insert({ conversationId: convo.id, role: "user", content: "hi" });
    await deps.messages.insert({ conversationId: convo.id, role: "assistant", content: "hello!" });
    const turn = await deps.turnSummaries.insert({
      turnId: "22222222-2222-4222-8222-222222222222",
      conversationId: convo.id,
      userId: owner.id,
      outcome: "iteration_cap",
      iterations: 5,
      toolsCalled: ["memory", "weather"],
      toolErrors: 1,
      tokensIn: 120,
      tokensOut: 40,
      costCents: 2.5,
      latencyMs: 4321,
      finishReasons: ["tool_calls", "stop"],
    });

    const res = await request(app).get(`/api/dashboard/conversations/${convo.id}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.turns).toEqual([
      {
        id: turn.id,
        turnId: "22222222-2222-4222-8222-222222222222",
        outcome: "iteration_cap",
        iterations: 5,
        toolsCalled: ["memory", "weather"],
        toolErrors: 1,
        tokensIn: 120,
        tokensOut: 40,
        costCents: 2.5,
        latencyMs: 4321,
        finishReasons: ["tool_calls", "stop"],
        createdAt: turn.created_at.toISOString(),
      },
    ]);
  });

  it("windows turn records to the page, so paging back never repeats one (A-6)", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const convo = await deps.conversations.getOrCreate(owner.id, "chat", "chan-1");
    const record = (outcome: "final_answer" | "provider_error") =>
      deps.turnSummaries.insert({
        turnId: "33333333-3333-4333-8333-333333333333",
        conversationId: convo.id,
        userId: owner.id,
        outcome,
        iterations: 1,
        toolsCalled: [],
        toolErrors: 0,
        tokensIn: 10,
        tokensOut: 5,
        costCents: 0.1,
        latencyMs: 100,
        finishReasons: ["stop"],
      });
    // Two turns of two messages each, each closed by its own record.
    for (const text of ["a", "b"]) {
      await deps.messages.insert({ conversationId: convo.id, role: "user", content: text });
      await deps.messages.insert({ conversationId: convo.id, role: "assistant", content: text });
    }
    const first = await record("final_answer");
    for (const text of ["c", "d"]) {
      await deps.messages.insert({ conversationId: convo.id, role: "user", content: text });
      await deps.messages.insert({ conversationId: convo.id, role: "assistant", content: text });
    }
    const second = await record("provider_error");

    const newest = await request(app).get(
      `/api/dashboard/conversations/${convo.id}/messages?limit=4`,
    );
    const older = await request(app).get(
      `/api/dashboard/conversations/${convo.id}/messages?limit=4&before=${newest.body.messages[0].id}`,
    );

    // The newest page carries the record written after its last message; the older
    // page carries only the earlier one. The two windows tile without overlap.
    expect(newest.body.turns.map((t: { id: string }) => t.id)).toEqual([second.id]);
    expect(older.body.turns.map((t: { id: string }) => t.id)).toEqual([first.id]);
  });

  it("returns no turn records for an empty thread", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const convo = await deps.conversations.getOrCreate(owner.id, "chat", "chan-1");

    const res = await request(app).get(`/api/dashboard/conversations/${convo.id}/messages`);
    expect(res.body.messages).toEqual([]);
    expect(res.body.turns).toEqual([]);
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

describe("GET /api/dashboard/conversations/:id/export.csv", () => {
  it("downloads the thread oldest-first as CSV with RFC 4180 quoting", async () => {
    const { app, deps } = buildDashboardTestApp();
    const owner = await provisionTestOwner(deps);
    const convo = await deps.conversations.getOrCreate(owner.id, "chat", "chan-1");
    await deps.messages.insert({ conversationId: convo.id, role: "user", content: 'hi, "Aivo"' });
    await deps.messages.insert({ conversationId: convo.id, role: "tool", content: null });
    await deps.messages.insert({ conversationId: convo.id, role: "assistant", content: "hello!" });

    const res = await request(app).get(`/api/dashboard/conversations/${convo.id}/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename="aivo-activity-chat-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers["x-export-truncated"]).toBeUndefined();
    const lines = res.text.trimEnd().split("\n");
    expect(lines[0]).toBe("created_at,role,content,tokens_in,tokens_out");
    expect(lines).toHaveLength(4);
    // Oldest first; commas/quotes quoted; null content and tokens export as empty fields.
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z,user,"hi, ""Aivo""",,$/);
    expect(lines[2]).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z,tool,,,$/);
    expect(lines[3]).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z,assistant,hello!,,$/);
  });

  it("404s another user's thread and 400s a bad id", async () => {
    const { app, deps } = buildDashboardTestApp();
    await provisionTestOwner(deps);
    const other = await deps.users.upsertByDiscordId({
      discordUserId: "someone-else",
      displayName: null,
      isOwner: false,
    });
    const foreign = await deps.conversations.getOrCreate(other.id, "chat", "chan-9");

    expect(
      (await request(app).get(`/api/dashboard/conversations/${foreign.id}/export.csv`)).status,
    ).toBe(404);
    expect((await request(app).get("/api/dashboard/conversations/nope/export.csv")).status).toBe(
      400,
    );
  });
});

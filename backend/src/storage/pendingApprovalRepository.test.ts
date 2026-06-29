import { describe, expect, it } from "vitest";
import { ConversationRepository } from "./conversationRepository.js";
import { PendingApprovalRepository } from "./pendingApprovalRepository.js";
import { UserRepository } from "./userRepository.js";
import { testDb, useCleanDb } from "../test/db.js";

useCleanDb();

async function setup() {
  const db = testDb();
  const approvals = new PendingApprovalRepository(db);
  const user = await new UserRepository(db).upsertByDiscordId({
    discordUserId: "u1",
    displayName: null,
    isOwner: true,
  });
  const convo = await new ConversationRepository(db).getOrCreate(user.id, "chat", "chan-1");
  return { approvals, userId: user.id, conversationId: convo.id };
}

const make = (over = {}) => ({
  userId: "",
  conversationId: "",
  triggerMessageId: "msg-1",
  estimatedCostCents: 60,
  taskType: "chat",
  ...over,
});

describe("PendingApprovalRepository", () => {
  it("creates a pending approval and finds it by id", async () => {
    const { approvals, userId, conversationId } = await setup();
    const row = await approvals.create(make({ userId, conversationId }));
    expect(row.status).toBe("pending");
    expect(Number(row.estimated_cost_cents)).toBe(60);
    expect((await approvals.findById(row.id))?.id).toBe(row.id);
  });

  it("resolveIfPending transitions once, then refuses a second time", async () => {
    const { approvals, userId, conversationId } = await setup();
    const row = await approvals.create(make({ userId, conversationId }));
    const first = await approvals.resolveIfPending(row.id, "approved");
    expect(first?.status).toBe("approved");
    expect(await approvals.resolveIfPending(row.id, "cancelled")).toBeUndefined();
  });

  it("expireOlderThan sweeps stale pending rows only", async () => {
    const { approvals, userId, conversationId } = await setup();
    await approvals.create(make({ userId, conversationId }));
    // Cutoff in the future expires everything still pending.
    const swept = await approvals.expireOlderThan(new Date(Date.now() + 60_000));
    expect(swept).toBe(1);
    // Nothing pending remains to sweep.
    expect(await approvals.expireOlderThan(new Date(Date.now() + 60_000))).toBe(0);
  });
});

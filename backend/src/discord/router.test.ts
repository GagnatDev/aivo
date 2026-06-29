import { describe, expect, it } from "vitest";
import { resolveApproval } from "./router.js";
import { makeFakeLlm, textResult } from "../test/fakeLlm.js";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";

useCleanDb();

async function setupPending() {
  const deps = makeAgentDeps(makeFakeLlm([textResult("the resumed answer")]));
  const { userId, conversationId } = await provisionUser(deps, OWNER_ID);
  const approval = await deps.pendingApprovals.create({
    userId,
    conversationId,
    triggerMessageId: "trigger-1",
    estimatedCostCents: 75,
    taskType: "chat",
  });
  return { deps, approvalId: approval.id };
}

describe("resolveApproval", () => {
  it("approves and resumes the turn for the original requester", async () => {
    const { deps, approvalId } = await setupPending();
    const outcome = await resolveApproval(deps, { action: "approve", approvalId, clickerDiscordId: OWNER_ID });
    expect(outcome.type).toBe("approved");
    if (outcome.type === "approved") expect(outcome.followUpReply).toBe("the resumed answer");
    expect((await deps.pendingApprovals.findById(approvalId))?.status).toBe("approved");
  });

  it("cancels without running the turn", async () => {
    const { deps, approvalId } = await setupPending();
    const outcome = await resolveApproval(deps, { action: "cancel", approvalId, clickerDiscordId: OWNER_ID });
    expect(outcome.type).toBe("cancelled");
    expect((await deps.pendingApprovals.findById(approvalId))?.status).toBe("cancelled");
  });

  it("denies a click from someone other than the requester", async () => {
    const { deps, approvalId } = await setupPending();
    const outcome = await resolveApproval(deps, { action: "approve", approvalId, clickerDiscordId: "intruder" });
    expect(outcome.type).toBe("denied");
    // Still pending — the intruder's click changed nothing.
    expect((await deps.pendingApprovals.findById(approvalId))?.status).toBe("pending");
  });

  it("reports expired on a second resolution of the same approval", async () => {
    const { deps, approvalId } = await setupPending();
    await resolveApproval(deps, { action: "cancel", approvalId, clickerDiscordId: OWNER_ID });
    const second = await resolveApproval(deps, { action: "approve", approvalId, clickerDiscordId: OWNER_ID });
    expect(second.type).toBe("expired");
  });
});

import { describe, expect, it } from "vitest";
import type { DiscordConfig } from "./config.js";
import { type MessageMeta, resolveApproval, shouldRespond } from "./router.js";
import { makeFakeLlm, textResult } from "../test/fakeLlm.js";
import { makeAgentDeps, OWNER_ID, provisionUser } from "../test/agentDeps.js";
import { useCleanDb } from "../test/db.js";

useCleanDb();

const CFG: DiscordConfig = {
  botToken: "token",
  guildId: "guild-1",
  homeChannelId: "home-1",
  youtubeChannelId: "youtube-1",
  offlineAckThresholdMinutes: 30,
};

/** A human message in the home channel — the baseline each case perturbs. */
function meta(overrides: Partial<MessageMeta> = {}): MessageMeta {
  return {
    isBot: false,
    guildId: "guild-1",
    channelId: "home-1",
    mentionsMe: false,
    referencedMessageAuthorIsMe: false,
    ...overrides,
  };
}

describe("shouldRespond", () => {
  const cases: Array<{ name: string; meta: MessageMeta; expected: boolean }> = [
    { name: "human in the home channel", meta: meta(), expected: true },
    { name: "bot in the home channel", meta: meta({ isBot: true }), expected: false },
    {
      name: "message from another guild",
      meta: meta({ guildId: "other-guild" }),
      expected: false,
    },
    { name: "direct message (no guild)", meta: meta({ guildId: null }), expected: false },
    {
      name: "other channel, not mentioned, not a reply",
      meta: meta({ channelId: "other-1" }),
      expected: false,
    },
    {
      name: "human in the youtube channel (digest feedback surface)",
      meta: meta({ channelId: "youtube-1" }),
      expected: true,
    },
    {
      name: "other channel, mentioned",
      meta: meta({ channelId: "other-1", mentionsMe: true }),
      expected: true,
    },
    {
      name: "other channel, reply to Aivo",
      meta: meta({ channelId: "other-1", referencedMessageAuthorIsMe: true }),
      expected: true,
    },
    {
      name: "other channel, mentioned but wrong guild",
      meta: meta({ channelId: "other-1", mentionsMe: true, guildId: "other-guild" }),
      expected: false,
    },
    {
      name: "bot mention in another channel",
      meta: meta({ channelId: "other-1", mentionsMe: true, isBot: true }),
      expected: false,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(shouldRespond(c.meta, CFG)).toBe(c.expected);
    });
  }
});

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
    const outcome = await resolveApproval(deps, {
      action: "approve",
      approvalId,
      clickerDiscordId: OWNER_ID,
    });
    expect(outcome.type).toBe("approved");
    if (outcome.type === "approved") expect(outcome.followUpReply).toBe("the resumed answer");
    expect((await deps.pendingApprovals.findById(approvalId))?.status).toBe("approved");
  });

  it("cancels without running the turn", async () => {
    const { deps, approvalId } = await setupPending();
    const outcome = await resolveApproval(deps, {
      action: "cancel",
      approvalId,
      clickerDiscordId: OWNER_ID,
    });
    expect(outcome.type).toBe("cancelled");
    expect((await deps.pendingApprovals.findById(approvalId))?.status).toBe("cancelled");
  });

  it("denies a click from someone other than the requester", async () => {
    const { deps, approvalId } = await setupPending();
    const outcome = await resolveApproval(deps, {
      action: "approve",
      approvalId,
      clickerDiscordId: "intruder",
    });
    expect(outcome.type).toBe("denied");
    // Still pending — the intruder's click changed nothing.
    expect((await deps.pendingApprovals.findById(approvalId))?.status).toBe("pending");
  });

  it("reports expired on a second resolution of the same approval", async () => {
    const { deps, approvalId } = await setupPending();
    await resolveApproval(deps, { action: "cancel", approvalId, clickerDiscordId: OWNER_ID });
    const second = await resolveApproval(deps, {
      action: "approve",
      approvalId,
      clickerDiscordId: OWNER_ID,
    });
    expect(second.type).toBe("expired");
  });
});

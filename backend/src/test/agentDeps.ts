import type { LlmProvider } from "../llm/provider.js";
import type { UnforkedClient } from "../unforked/client.js";
import type { AgentConfig, AgentDeps } from "../agent/deps.js";
import { systemClock, type Clock } from "../agent/clock.js";
import { BudgetConfigRepository } from "../storage/budgetConfigRepository.js";
import { ConversationRepository } from "../storage/conversationRepository.js";
import { DigestItemRepository } from "../storage/digestItemRepository.js";
import { DigestRepository } from "../storage/digestRepository.js";
import { FeedbackRepository } from "../storage/feedbackRepository.js";
import { LlmUsageRepository } from "../storage/llmUsageRepository.js";
import { MemoryRepository } from "../storage/memoryRepository.js";
import { MessageRepository } from "../storage/messageRepository.js";
import { ModelPricingRepository } from "../storage/modelPricingRepository.js";
import { PendingApprovalRepository } from "../storage/pendingApprovalRepository.js";
import { ProfileRepository } from "../storage/profileRepository.js";
import { ReminderRepository } from "../storage/reminderRepository.js";
import { SettingsPermissionsRepository } from "../storage/settingsPermissionsRepository.js";
import { SettingsRepository } from "../storage/settingsRepository.js";
import { UserRepository } from "../storage/userRepository.js";
import { VideoRepository } from "../storage/videoRepository.js";
import { YoutubeAccountRepository } from "../storage/youtubeAccountRepository.js";
import { YoutubeChannelRepository } from "../storage/youtubeChannelRepository.js";
import { makeFakeLlm } from "./fakeLlm.js";
import { testDb } from "./db.js";

export const OWNER_ID = "owner-discord-id";

/** The `loadEnv()` defaults, so tests match production unless a case overrides them. */
export const TEST_AGENT_CONFIG: AgentConfig = {
  agentMaxToolIterations: 5,
  toolKeywordGating: false,
  llmMaxOutputTokens: 1024,
  contextMessageLimit: 30,
  contextTokenBudget: 4000,
  toolResultMaxTokens: 2000,
  memoryInjectLimit: 20,
  approvalTtlMinutes: 60,
  voiceMaxDurationSecs: 60,
  voiceMaxBytes: 8_000_000,
};

/**
 * A settable fake clock for deterministic time-dependent tests. `set()` moves "now"
 * to a fixed instant and `advance()` ticks it forward, so rollover/expiry/staleness
 * can be exercised without touching the wall clock. Defaults to the Unix epoch.
 */
export class FakeClock implements Clock {
  private current: Date;
  constructor(initial: Date = new Date(0)) {
    this.current = initial;
  }
  now(): Date {
    return this.current;
  }
  set(when: Date): void {
    this.current = when;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * Assemble a full AgentDeps over the Testcontainers DB with the given LLM provider.
 * Config defaults to {@link TEST_AGENT_CONFIG}; pass an override to vary a single knob
 * for a case (e.g. a lower `agentMaxToolIterations`) without touching module state.
 * `clock` defaults to the real {@link systemClock}; pass a {@link FakeClock} to make a
 * time-dependent case deterministic.
 */
export function makeAgentDeps(
  llm: LlmProvider = makeFakeLlm([]),
  config: Partial<AgentConfig> = {},
  clock: Clock = systemClock,
  unforked: UnforkedClient | null = null,
): AgentDeps {
  const db = testDb();
  return {
    users: new UserRepository(db),
    conversations: new ConversationRepository(db),
    messages: new MessageRepository(db),
    memories: new MemoryRepository(db),
    settings: new SettingsRepository(db),
    settingsPermissions: new SettingsPermissionsRepository(db),
    modelPricing: new ModelPricingRepository(db),
    llmUsage: new LlmUsageRepository(db),
    budgetConfig: new BudgetConfigRepository(db),
    pendingApprovals: new PendingApprovalRepository(db),
    profiles: new ProfileRepository(db),
    reminders: new ReminderRepository(db),
    youtubeAccount: new YoutubeAccountRepository(db),
    youtubeChannels: new YoutubeChannelRepository(db),
    videos: new VideoRepository(db),
    digests: new DigestRepository(db),
    digestItems: new DigestItemRepository(db),
    feedback: new FeedbackRepository(db),
    llm,
    unforked,
    clock,
    ownerDiscordUserId: OWNER_ID,
    config: { ...TEST_AGENT_CONFIG, ...config },
  };
}

/** Provision a user + their chat conversation; returns ids and is_owner. */
export async function provisionUser(
  deps: AgentDeps,
  discordUserId: string,
): Promise<{ userId: string; isOwner: boolean; conversationId: string }> {
  const user = await deps.users.upsertByDiscordId({
    discordUserId,
    displayName: null,
    isOwner: discordUserId === deps.ownerDiscordUserId,
  });
  const convo = await deps.conversations.getOrCreate(user.id, "chat", "chan-1");
  return { userId: user.id, isOwner: user.is_owner, conversationId: convo.id };
}

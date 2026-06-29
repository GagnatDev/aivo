import type { LlmProvider } from "../llm/provider.js";
import type { AgentDeps } from "../agent/deps.js";
import { BudgetConfigRepository } from "../storage/budgetConfigRepository.js";
import { ConversationRepository } from "../storage/conversationRepository.js";
import { LlmUsageRepository } from "../storage/llmUsageRepository.js";
import { MemoryRepository } from "../storage/memoryRepository.js";
import { MessageRepository } from "../storage/messageRepository.js";
import { ModelPricingRepository } from "../storage/modelPricingRepository.js";
import { PendingApprovalRepository } from "../storage/pendingApprovalRepository.js";
import { SettingsPermissionsRepository } from "../storage/settingsPermissionsRepository.js";
import { SettingsRepository } from "../storage/settingsRepository.js";
import { UserRepository } from "../storage/userRepository.js";
import { makeFakeLlm } from "./fakeLlm.js";
import { testDb } from "./db.js";

export const OWNER_ID = "owner-discord-id";

/** Assemble a full AgentDeps over the Testcontainers DB with the given LLM provider. */
export function makeAgentDeps(llm: LlmProvider = makeFakeLlm([])): AgentDeps {
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
    llm,
    ownerDiscordUserId: OWNER_ID,
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

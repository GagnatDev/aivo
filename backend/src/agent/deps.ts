import type { LlmProvider } from "../llm/provider.js";
import type { BudgetConfigRepository } from "../storage/budgetConfigRepository.js";
import type { ConversationRepository } from "../storage/conversationRepository.js";
import type { LlmUsageRepository } from "../storage/llmUsageRepository.js";
import type { MemoryRepository } from "../storage/memoryRepository.js";
import type { MessageRepository } from "../storage/messageRepository.js";
import type { ModelPricingRepository } from "../storage/modelPricingRepository.js";
import type { PendingApprovalRepository } from "../storage/pendingApprovalRepository.js";
import type { SettingsPermissionsRepository } from "../storage/settingsPermissionsRepository.js";
import type { SettingsRepository } from "../storage/settingsRepository.js";
import type { UserRepository } from "../storage/userRepository.js";

/**
 * Everything the agent core and its tools need, injected so the agent stays free of
 * discord.js and is unit-testable against a real database + a fake LlmProvider. This
 * is the superset that replaces the original HandleMessageDeps.
 */
export interface AgentDeps {
  users: UserRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  memories: MemoryRepository;
  settings: SettingsRepository;
  settingsPermissions: SettingsPermissionsRepository;
  modelPricing: ModelPricingRepository;
  llmUsage: LlmUsageRepository;
  budgetConfig: BudgetConfigRepository;
  pendingApprovals: PendingApprovalRepository;
  llm: LlmProvider;
  /** Discord id of the owner; flags is_owner on JIT provisioning. */
  ownerDiscordUserId: string;
}

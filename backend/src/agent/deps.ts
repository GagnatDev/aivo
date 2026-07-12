import type { LlmProvider } from "../llm/provider.js";
import type { UnforkedClient } from "../unforked/client.js";
import type { Clock } from "./clock.js";
import type { BudgetConfigRepository } from "../storage/budgetConfigRepository.js";
import type { ConversationRepository } from "../storage/conversationRepository.js";
import type { DigestItemRepository } from "../storage/digestItemRepository.js";
import type { DigestRepository } from "../storage/digestRepository.js";
import type { FeedbackRepository } from "../storage/feedbackRepository.js";
import type { LlmUsageRepository } from "../storage/llmUsageRepository.js";
import type { MemoryRepository } from "../storage/memoryRepository.js";
import type { MessageRepository } from "../storage/messageRepository.js";
import type { ModelPricingRepository } from "../storage/modelPricingRepository.js";
import type { PendingApprovalRepository } from "../storage/pendingApprovalRepository.js";
import type { ProfileRepository } from "../storage/profileRepository.js";
import type { ReminderRepository } from "../storage/reminderRepository.js";
import type { SettingsPermissionsRepository } from "../storage/settingsPermissionsRepository.js";
import type { SettingsRepository } from "../storage/settingsRepository.js";
import type { UserRepository } from "../storage/userRepository.js";
import type { VideoRepository } from "../storage/videoRepository.js";
import type { YoutubeAccountRepository } from "../storage/youtubeAccountRepository.js";
import type { YoutubeChannelRepository } from "../storage/youtubeChannelRepository.js";

/**
 * The agent-relevant config knobs, populated once from `loadEnv()` at the composition
 * root and injected via {@link AgentDeps}. Threading these through DI (rather than
 * importing the `env` singleton) keeps the agent core free of `process.env` and lets
 * tests vary config per-case without mutating shared module state — so `AgentDeps` is
 * the honest, complete contract of what a turn needs.
 */
export interface AgentConfig {
  /** Hard cap on tool round-trips per turn (runaway backstop). `AGENT_MAX_TOOL_ITERATIONS`. */
  agentMaxToolIterations: number;
  /** Upper bound on completion tokens per LLM call. `LLM_MAX_OUTPUT_TOKENS`. */
  llmMaxOutputTokens: number;
  /** Recent conversation messages to replay as context. `AGENT_CONTEXT_MESSAGE_LIMIT`. */
  contextMessageLimit: number;
  /** Remembered facts injected into the system prompt each turn. `AGENT_MEMORY_INJECT_LIMIT`. */
  memoryInjectLimit: number;
  /** Pending approval prompts older than this are swept to expired. `APPROVAL_TTL_MINUTES`. */
  approvalTtlMinutes: number;
}

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
  profiles: ProfileRepository;
  reminders: ReminderRepository;
  youtubeAccount: YoutubeAccountRepository;
  youtubeChannels: YoutubeChannelRepository;
  videos: VideoRepository;
  digests: DigestRepository;
  digestItems: DigestItemRepository;
  feedback: FeedbackRepository;
  llm: LlmProvider;
  /**
   * Read client for unforked, the family meal planner — null until
   * UNFORKED_BASE_URL is configured. The API key it sends is read per call from
   * unforked_connection (registered via the dashboard, see routes/dashboard/unforked.ts).
   */
  unforked: UnforkedClient | null;
  /** Reads "now" for time-dependent business logic (rollover, expiry, staleness). */
  clock: Clock;
  /** Discord id of the owner; flags is_owner on JIT provisioning. */
  ownerDiscordUserId: string;
  /** Config knobs threaded from `loadEnv()` at the composition root. */
  config: AgentConfig;
}

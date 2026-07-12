import { buildApp } from "../app.js";
import type { AuthProvider } from "../auth/index.js";
import { createDevAuthProvider } from "../auth/devProvider.js";
import type { DashboardDeps } from "../routes/dashboard/index.js";
import { BudgetConfigRepository } from "../storage/budgetConfigRepository.js";
import { ConversationRepository } from "../storage/conversationRepository.js";
import { DigestItemRepository } from "../storage/digestItemRepository.js";
import { DigestRepository } from "../storage/digestRepository.js";
import { FeedbackRepository } from "../storage/feedbackRepository.js";
import { LlmUsageRepository } from "../storage/llmUsageRepository.js";
import { MemoryRepository } from "../storage/memoryRepository.js";
import { MessageRepository } from "../storage/messageRepository.js";
import { ModelPricingRepository } from "../storage/modelPricingRepository.js";
import { ProfileRepository } from "../storage/profileRepository.js";
import { SettingsRepository } from "../storage/settingsRepository.js";
import { UnforkedConnectionRepository } from "../storage/unforkedConnectionRepository.js";
import { UserRepository } from "../storage/userRepository.js";
import type { UnforkedClient } from "../unforked/client.js";
import { VideoRepository } from "../storage/videoRepository.js";
import { YoutubeAccountRepository } from "../storage/youtubeAccountRepository.js";
import { testDb } from "./db.js";

export interface DashboardTestHarness {
  app: ReturnType<typeof buildApp>;
  deps: DashboardDeps;
}

export interface DashboardTestOptions {
  webRoot?: string;
  /** Defaults to the env schema's default (20) so ME-5 math is testable. */
  memoryInjectLimit?: number;
  /** Simulated Discord gateway probe; omitted = "unknown" in the health widget. */
  gatewayStatus?: () => boolean;
  /** Auth provider under test; defaults to the offline dev provider. */
  provider?: AuthProvider;
  /** unforked client (usually test/fakeUnforked.ts); omitted = "not configured". */
  unforked?: UnforkedClient | null;
}

/** The dashboard app wired to the test DB with the dev auth provider by default. */
export function buildDashboardTestApp(options: DashboardTestOptions = {}): DashboardTestHarness {
  const db = testDb();
  const deps: DashboardDeps = {
    users: new UserRepository(db),
    llmUsage: new LlmUsageRepository(db),
    budgetConfig: new BudgetConfigRepository(db),
    modelPricing: new ModelPricingRepository(db),
    settings: new SettingsRepository(db),
    memories: new MemoryRepository(db),
    digests: new DigestRepository(db),
    digestItems: new DigestItemRepository(db),
    videos: new VideoRepository(db),
    conversations: new ConversationRepository(db),
    messages: new MessageRepository(db),
    profiles: new ProfileRepository(db),
    feedback: new FeedbackRepository(db),
    youtubeAccount: new YoutubeAccountRepository(db),
    unforkedConnection: new UnforkedConnectionRepository(db),
    unforked: options.unforked ?? null,
    config: {
      memoryInjectLimit: options.memoryInjectLimit ?? 20,
    },
    ...(options.gatewayStatus ? { gatewayStatus: options.gatewayStatus } : {}),
  };
  const appOptions: Parameters<typeof buildApp>[0] = {
    auth: {
      provider: options.provider ?? createDevAuthProvider(),
      dashboard: deps,
    },
  };
  if (options.webRoot) appOptions.webRoot = options.webRoot;
  return { app: buildApp(appOptions), deps };
}

/** JIT-provision the owner row the way a first Discord message would. */
export function provisionTestOwner(deps: DashboardDeps) {
  return deps.users.upsertByDiscordId({
    discordUserId: "discord-owner",
    displayName: "Ann-Katrin",
    isOwner: true,
  });
}

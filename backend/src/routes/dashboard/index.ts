import { Router } from "express";
import type { AuthProvider } from "../../auth/index.js";
import { resolveUser } from "../../middleware/resolveUser.js";
import type { BudgetConfigRepository } from "../../storage/budgetConfigRepository.js";
import type { ConversationRepository } from "../../storage/conversationRepository.js";
import type { DigestItemRepository } from "../../storage/digestItemRepository.js";
import type { DigestRepository } from "../../storage/digestRepository.js";
import type { FeedbackRepository } from "../../storage/feedbackRepository.js";
import type { LlmUsageRepository } from "../../storage/llmUsageRepository.js";
import type { MemoryRepository } from "../../storage/memoryRepository.js";
import type { MessageRepository } from "../../storage/messageRepository.js";
import type { ModelPricingRepository } from "../../storage/modelPricingRepository.js";
import type { ProfileRepository } from "../../storage/profileRepository.js";
import type { SettingsRepository } from "../../storage/settingsRepository.js";
import type { UnforkedConnectionRepository } from "../../storage/unforkedConnectionRepository.js";
import type { UserRepository } from "../../storage/userRepository.js";
import type { UnforkedClient } from "../../unforked/client.js";
import type { VideoRepository } from "../../storage/videoRepository.js";
import type { YoutubeAccountRepository } from "../../storage/youtubeAccountRepository.js";
import { activityRoutes } from "./activity.js";
import { digestsRoutes } from "./digests.js";
import { memoriesRoutes } from "./memories.js";
import { profilesRoutes } from "./profiles.js";
import { modelsRoutes } from "./models.js";
import { overviewRoutes } from "./overview.js";
import { settingsRoutes } from "./settings.js";
import { unforkedRoutes } from "./unforked.js";
import { usageRoutes } from "./usage.js";

/**
 * The repositories the dashboard API reads from. Handlers delegate to these —
 * no business logic lives in routes (PRD §5.1). Grows per milestone.
 */
export interface DashboardDeps {
  users: UserRepository;
  llmUsage: LlmUsageRepository;
  budgetConfig: BudgetConfigRepository;
  modelPricing: ModelPricingRepository;
  settings: SettingsRepository;
  memories: MemoryRepository;
  digests: DigestRepository;
  digestItems: DigestItemRepository;
  videos: VideoRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  profiles: ProfileRepository;
  feedback: FeedbackRepository;
  youtubeAccount: YoutubeAccountRepository;
  unforkedConnection: UnforkedConnectionRepository;
  /**
   * unforked machine-API client for verifying keys at registration; null until
   * UNFORKED_BASE_URL is configured (the section shows "not configured").
   */
  unforked: UnforkedClient | null;
  /** App-config values surfaced read-only (PRD §4.5 — never the raw env). */
  config: {
    /** AGENT_MEMORY_INJECT_LIMIT — max memories injected into agent context. */
    memoryInjectLimit: number;
  };
  /**
   * Live Discord gateway probe for the health widget (O-6). Optional because the
   * gateway logs in after the HTTP server starts (and doesn't exist in tests) —
   * absent means "unknown", not "down".
   */
  gatewayStatus?: () => boolean;
}

/**
 * The authenticated read-only dashboard API under /api/dashboard (PRD §5.4).
 * Every route runs behind authMiddleware (reads the sidecar's verified identity
 * headers into `req.user`) and resolveUser (maps to `req.userId`, enforces the v1
 * owner-only gate) — so handlers can assume a resolved, authorized user.
 */
export function dashboardRouter(auth: AuthProvider, deps: DashboardDeps): Router {
  const router = Router();
  router.use("/api/dashboard", auth.authMiddleware, resolveUser(deps.users));

  // Who am I — the shell's session probe (M0).
  router.get("/api/dashboard/me", (req, res) => {
    const user = req.appUser!;
    res.json({
      user: {
        id: user.id,
        displayName: user.display_name,
        isOwner: user.is_owner,
      },
    });
  });

  router.use(usageRoutes(deps));
  router.use(modelsRoutes(deps));
  router.use(memoriesRoutes(deps));
  router.use(overviewRoutes(deps));
  router.use(digestsRoutes(deps));
  router.use(activityRoutes(deps));
  router.use(settingsRoutes(deps));
  router.use(unforkedRoutes(deps));
  router.use(profilesRoutes(deps));

  return router;
}

import { Router } from "express";
import type { AuthProvider } from "../../auth/index.js";
import { resolveUser } from "../../middleware/resolveUser.js";
import type { BudgetConfigRepository } from "../../storage/budgetConfigRepository.js";
import type { LlmUsageRepository } from "../../storage/llmUsageRepository.js";
import type { MemoryRepository } from "../../storage/memoryRepository.js";
import type { ModelPricingRepository } from "../../storage/modelPricingRepository.js";
import type { SettingsRepository } from "../../storage/settingsRepository.js";
import type { UserRepository } from "../../storage/userRepository.js";
import { memoriesRoutes } from "./memories.js";
import { modelsRoutes } from "./models.js";
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
  /** App-config values surfaced read-only (PRD §4.5 — never the raw env). */
  config: {
    /** AGENT_MEMORY_INJECT_LIMIT — max memories injected into agent context. */
    memoryInjectLimit: number;
  };
}

/**
 * The authenticated read-only dashboard API under /api/dashboard (PRD §5.4).
 * Every route runs behind authMiddleware (verifies the token, sets `req.user`)
 * and resolveUser (maps to `req.userId`, enforces the v1 owner-only gate) — so
 * handlers can assume a resolved, authorized user.
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

  return router;
}

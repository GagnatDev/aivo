import { buildApp } from "../app.js";
import { createDevAuthProvider } from "../auth/devProvider.js";
import type { DashboardDeps } from "../routes/dashboard/index.js";
import { BudgetConfigRepository } from "../storage/budgetConfigRepository.js";
import { LlmUsageRepository } from "../storage/llmUsageRepository.js";
import { ModelPricingRepository } from "../storage/modelPricingRepository.js";
import { SettingsRepository } from "../storage/settingsRepository.js";
import { UserRepository } from "../storage/userRepository.js";
import { testDb } from "./db.js";

export interface DashboardTestHarness {
  app: ReturnType<typeof buildApp>;
  deps: DashboardDeps;
}

/** The dashboard app wired to the test DB with the dev auth provider. */
export function buildDashboardTestApp(webRoot?: string): DashboardTestHarness {
  const db = testDb();
  const deps: DashboardDeps = {
    users: new UserRepository(db),
    llmUsage: new LlmUsageRepository(db),
    budgetConfig: new BudgetConfigRepository(db),
    modelPricing: new ModelPricingRepository(db),
    settings: new SettingsRepository(db),
  };
  const options: Parameters<typeof buildApp>[0] = {
    auth: {
      provider: createDevAuthProvider(),
      callbackPath: "/auth/callback",
      dashboard: deps,
    },
  };
  if (webRoot) options.webRoot = webRoot;
  return { app: buildApp(options), deps };
}

/** JIT-provision the owner row the way a first Discord message would. */
export function provisionTestOwner(deps: DashboardDeps) {
  return deps.users.upsertByDiscordId({
    discordUserId: "discord-owner",
    displayName: "Ann-Katrin",
    isOwner: true,
  });
}

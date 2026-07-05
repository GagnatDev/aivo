import cron, { type ScheduledTask } from "node-cron";
import type { AgentDeps } from "../agent/deps.js";
import type { YoutubeIntegrations } from "../digest/pipeline.js";
import { logger } from "../logger.js";
import { runDueWork, type Deliverers } from "./tick.js";

/**
 * The "when" of the scheduler: in-process node-cron ticking every minute and polling
 * for due work (docs/technical-overview.md — polling, not per-item timers, so the
 * brief Recreate-deploy downtime self-heals on the next tick). Thin wiring by design;
 * the testable logic lives in scheduler/tick.ts.
 */
export function startScheduler(
  deps: AgentDeps,
  yt: YoutubeIntegrations | null,
  deliverers: Deliverers,
): ScheduledTask {
  if (!yt) {
    logger.warn("YouTube credentials not configured — digest scheduler is idle");
  }
  return cron.schedule("* * * * *", async () => {
    try {
      await runDueWork(deps, yt, deliverers, deps.clock.now());
    } catch (err) {
      logger.error({ err }, "scheduler tick failed");
    }
  });
}

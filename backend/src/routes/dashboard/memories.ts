import { Router } from "express";
import { z } from "zod";
import type { MemoryRow } from "../../storage/memoryRepository.js";
import type { DashboardDeps } from "./index.js";

const listQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  category: z.enum(["preference", "fact", "context"]).optional(),
});

/** More hits than the agent tool's default 20 — a browse surface, not a prompt. */
const SEARCH_LIMIT = 100;

/** Pinned first, then recency — the exact prompt injection order (agent/context.ts). */
function injectionOrder(rows: MemoryRow[]): MemoryRow[] {
  return [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

/**
 * Memory endpoints (M3, PRD §4.5): list/search active memories with the same
 * ILIKE semantics (and wildcard escaping) as the agent's memory tool, category
 * filter, injection-order sort, and the "N of M injected" context hint (ME-5).
 * Read-only; pin/edit/forget stay in Discord for v1.
 */
export function memoriesRoutes(deps: DashboardDeps): Router {
  const router = Router();

  router.get("/api/dashboard/memories", async (req, res) => {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "bad_request", issues: query.error.issues });
      return;
    }
    const userId = req.userId!;
    const { q, category } = query.data;

    // The full active set always loads: it is the source of the count KPIs and the
    // category chips, which must not shrink when a search or filter is applied.
    const active = await deps.memories.listActive(userId);
    const matches = q ? await deps.memories.search(userId, q, SEARCH_LIMIT) : active;
    const filtered = category ? matches.filter((m) => m.category === category) : matches;

    const categoryCounts: Record<string, number> = {};
    for (const m of active) {
      const key = m.category ?? "uncategorized";
      categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
    }

    res.json({
      memories: injectionOrder(filtered).map((m) => ({
        id: m.id,
        category: m.category,
        content: m.content,
        source: m.source,
        pinned: m.pinned,
        createdAt: m.created_at.toISOString(),
      })),
      activeCount: active.length,
      injectedCount: Math.min(active.length, deps.config.memoryInjectLimit),
      injectLimit: deps.config.memoryInjectLimit,
      categoryCounts,
      query: q ?? null,
      category: category ?? null,
    });
  });

  return router;
}

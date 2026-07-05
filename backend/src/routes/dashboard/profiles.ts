import { Router } from "express";
import { z } from "zod";
import type { ProfileRow } from "../../storage/profileRepository.js";
import type { DashboardDeps } from "./index.js";

const kindParamSchema = z.object({
  kind: z.enum(["youtube_interest", "mail_importance"]),
});

function versionJson(row: ProfileRow) {
  return {
    id: row.id,
    version: row.version,
    body: row.body,
    isCurrent: row.is_current,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Profiles endpoint (M6, PRD ME-6/ME-7): the current versioned profile of a kind
 * plus its full history, newest first, so the UI can diff consecutive versions
 * and show how feedback evolved the profile. User-scoped; YouTube profiles are
 * owner-only by the v1 gate.
 */
export function profilesRoutes(deps: DashboardDeps): Router {
  const router = Router();

  router.get("/api/dashboard/profiles/:kind", async (req, res) => {
    const params = kindParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "bad_request", issues: params.error.issues });
      return;
    }
    const versions = await deps.profiles.listVersions(req.userId!, params.data.kind);
    const current = versions.find((v) => v.is_current);
    res.json({
      kind: params.data.kind,
      current: current ? versionJson(current) : null,
      versions: versions.map(versionJson),
    });
  });

  return router;
}

import { Router } from "express";
import { z } from "zod";
import { UnforkedApiError, type UnforkedMe } from "../../unforked/client.js";
import type { UnforkedConnectionRow } from "../../storage/unforkedConnectionRepository.js";
import type { DashboardDeps } from "./index.js";

const registerSchema = z.object({
  // unforked keys are `ufk_` + 32 bytes base64url; validate the shape before
  // making a network call with it.
  apiKey: z
    .string()
    .trim()
    .regex(/^ufk_[A-Za-z0-9_-]{20,}$/, "not an unforked API key (expected ufk_…)"),
});

function toStatus(configured: boolean, row: UnforkedConnectionRow | undefined) {
  return {
    configured,
    connected: row !== undefined,
    ownerEmail: row?.owner_email ?? null,
    keyName: row?.key_name ?? null,
    verifiedAt: row?.verified_at.toISOString() ?? null,
  };
}

/**
 * The unforked (family meal planner) connection: status, register, disconnect.
 * This is the dashboard's one deliberate write surface — the owner registers
 * the unforked API key HERE, on the Settings page, not over Discord chat (a
 * secret pasted into chat would sit in the message history and the LLM
 * context). The key is verified against unforked's /machine/v1/me before it is
 * stored, and the stored key is never echoed back out.
 *
 * Owner-only like the rest of the dashboard (resolveUser's v1 gate).
 */
export function unforkedRoutes(deps: DashboardDeps): Router {
  const router = Router();

  router.get("/api/dashboard/unforked", async (_req, res) => {
    const row = await deps.unforkedConnection.find();
    res.json(toStatus(deps.unforked !== null, row));
  });

  router.put("/api/dashboard/unforked", async (req, res) => {
    if (!deps.unforked) {
      res.status(409).json({
        error: "not configured",
        reason: "UNFORKED_BASE_URL is not set on this deployment",
      });
      return;
    }
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid request",
        reason: parsed.error.issues[0]?.message ?? "invalid body",
      });
      return;
    }

    let me: UnforkedMe;
    try {
      me = await deps.unforked.verifyKey(parsed.data.apiKey);
    } catch (err) {
      if (err instanceof UnforkedApiError && err.status === 401) {
        res.status(400).json({
          error: "key rejected",
          reason: "unforked rejected the API key — it may be revoked or mistyped",
        });
        return;
      }
      res.status(502).json({
        error: "unforked unreachable",
        reason: "could not reach unforked to verify the key — try again",
      });
      return;
    }

    const row = await deps.unforkedConnection.connect({
      apiKey: parsed.data.apiKey,
      ownerEmail: me.email,
      keyName: me.key.name,
      connectedByUserId: req.userId ?? null,
    });
    res.json(toStatus(true, row));
  });

  router.delete("/api/dashboard/unforked", async (_req, res) => {
    await deps.unforkedConnection.disconnect();
    res.status(204).end();
  });

  return router;
}

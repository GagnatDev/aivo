import { Router } from "express";
import { z } from "zod";
import type { DashboardDeps } from "./index.js";

const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  /** Page backwards: return messages strictly older than this message id. */
  before: z.string().uuid().optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

/**
 * Activity log endpoints (M5, PRD §4.7): the per-channel conversation list (A-1)
 * and the paginated message thread with roles, timestamps, and per-message token
 * counts where recorded (A-2, A-3). Threads are read newest-page-first with a
 * `before` cursor — full history retention makes them unbounded.
 */
export function activityRoutes(deps: DashboardDeps): Router {
  const router = Router();

  router.get("/api/dashboard/conversations", async (req, res) => {
    const conversations = await deps.conversations.listForUser(req.userId!);
    res.json({
      conversations: conversations.map((c) => ({
        id: c.id,
        channel: c.channel,
        createdAt: c.created_at.toISOString(),
        lastMessageAt: c.last_message_at.toISOString(),
      })),
    });
  });

  router.get("/api/dashboard/conversations/:id/messages", async (req, res) => {
    const params = idParamSchema.safeParse(req.params);
    const query = messagesQuerySchema.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const conversation = await deps.conversations.findByIdForUser(params.data.id, req.userId!);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const { limit, before } = query.data;
    const page = await deps.messages.listPage(conversation.id, {
      limit,
      ...(before !== undefined && { before }),
    });
    res.json({
      conversation: { id: conversation.id, channel: conversation.channel },
      messages: page.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at.toISOString(),
        tokensIn: m.tokens_in,
        tokensOut: m.tokens_out,
      })),
      hasMore: page.hasMore,
    });
  });

  return router;
}

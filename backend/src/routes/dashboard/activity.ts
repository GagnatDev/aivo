import { Router } from "express";
import { z } from "zod";
import { csvField, EXPORT_MAX_ROWS } from "./csv.js";
import type { DashboardDeps } from "./index.js";

const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  /** Page backwards: return messages strictly older than this message id. */
  before: z.string().uuid().optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

/**
 * Activity log endpoints (M5, PRD §4.7): the per-channel conversation list (A-1),
 * the paginated message thread with roles, timestamps, and per-message token
 * counts where recorded (A-2, A-3) plus the per-turn observability records covering
 * that page, and a CSV download of a thread (M6 polish). Threads are read
 * newest-page-first with a `before` cursor — full history retention makes them
 * unbounded.
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
    // The per-turn observability records covering this page (A-6). Scoped to the
    // same half-open window as the messages, so paging back never repeats a turn: the
    // window starts at the page's oldest message and ends just before the `before`
    // anchor (unbounded on the newest page, whose last turn's record is written after
    // its final message). An empty page has no window, hence no turns.
    const oldest = page.messages[0];
    const turns = oldest
      ? await deps.turnSummaries.listForWindow(conversation.id, {
          since: oldest.created_at,
          ...(before !== undefined && { beforeMessageId: before }),
        })
      : [];
    res.json({
      conversation: { id: conversation.id, channel: conversation.channel },
      messages: page.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        // Structured tool data (since migration 022): an assistant turn that requested
        // tools carries `toolCalls`, and a tool-result row carries the name it answers,
        // so the thread can render what ran instead of a blank "(no content recorded)".
        toolCalls: m.tool_calls,
        toolName: m.tool_name,
        createdAt: m.created_at.toISOString(),
        tokensIn: m.tokens_in,
        tokensOut: m.tokens_out,
      })),
      // One entry per agent turn that finished inside this window, oldest first — what
      // a message row can't say: how many round-trips it took, how long it ran, whether
      // it ended on a forced answer or a cap, and how many tool calls failed.
      turns: turns.map((t) => ({
        id: t.id,
        turnId: t.turn_id,
        outcome: t.outcome,
        iterations: t.iterations,
        toolsCalled: t.tools_called,
        toolErrors: t.tool_errors,
        tokensIn: t.tokens_in,
        tokensOut: t.tokens_out,
        costCents: t.cost_cents,
        latencyMs: t.latency_ms,
        finishReasons: t.finish_reasons,
        createdAt: t.created_at.toISOString(),
      })),
      hasMore: page.hasMore,
    });
  });

  // A conversation's thread as a CSV download, oldest-first. Threads are
  // unbounded, so the export carries the newest EXPORT_MAX_ROWS messages and
  // flags a truncated head the same way the usage export does.
  router.get("/api/dashboard/conversations/:id/export.csv", async (req, res) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const conversation = await deps.conversations.findByIdForUser(params.data.id, req.userId!);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const page = await deps.messages.listPage(conversation.id, { limit: EXPORT_MAX_ROWS });
    const lines = [
      "created_at,role,content,tokens_in,tokens_out",
      ...page.messages.map((m) =>
        [
          m.created_at.toISOString(),
          m.role,
          csvField(m.content ?? ""),
          m.tokens_in === null ? "" : String(m.tokens_in),
          m.tokens_out === null ? "" : String(m.tokens_out),
        ].join(","),
      ),
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="aivo-activity-${conversation.channel}-${stamp}.csv"`,
    );
    if (page.hasMore) res.setHeader("X-Export-Truncated", "true");
    res.send(`${lines.join("\n")}\n`);
  });

  return router;
}

import { z } from "zod";
import { parse, type AgentTool } from "./index.js";

const memoryArgs = z.object({
  action: z.enum(["list", "search", "write", "forget"]),
  term: z.string().optional(),
  content: z.string().optional(),
  category: z.enum(["preference", "fact", "context"]).optional(),
  id: z.string().optional(),
});

/**
 * Always-on (un-gated): captures durable facts/preferences/context about the user even
 * when no trigger word is present. See {@link selectToolSchemas} for why it has no gate.
 */
export const memoryTool: AgentTool = {
  schema: {
    name: "memory",
    description:
      "Read, write, or forget durable facts/preferences/context about the user. " +
      "Use action 'list' for 'what do you remember about me?', 'search' to find by keyword, " +
      "'write' to remember something new, and 'forget' (with the memory id from a list/search) " +
      "to soft-delete a memory.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "search", "write", "forget"] },
        term: { type: "string", description: "keyword query (action=search)" },
        content: { type: "string", description: "the memory text (action=write)" },
        category: {
          type: "string",
          enum: ["preference", "fact", "context"],
          description: "kind of memory (action=write)",
        },
        id: { type: "string", description: "memory id to forget (action=forget)" },
      },
      required: ["action"],
    },
  },
  async execute(args, ctx) {
    const p = parse(memoryArgs, args);
    if (!p.ok) return p.error;
    const { memories } = ctx.deps;
    switch (p.value.action) {
      case "list": {
        const rows = await memories.listActive(ctx.userId);
        return JSON.stringify(rows.map((m) => ({ id: m.id, category: m.category, content: m.content })));
      }
      case "search": {
        if (!p.value.term) return "Provide a 'term' to search.";
        const rows = await memories.search(ctx.userId, p.value.term);
        return JSON.stringify(rows.map((m) => ({ id: m.id, category: m.category, content: m.content })));
      }
      case "write": {
        if (!p.value.content) return "Provide 'content' to remember.";
        const row = await memories.insert({
          userId: ctx.userId,
          content: p.value.content,
          category: p.value.category ?? null,
          source: "chat",
        });
        return `Remembered (id ${row.id}).`;
      }
      case "forget": {
        if (!p.value.id) return "Provide the 'id' of the memory to forget.";
        const row = await memories.forget(p.value.id, ctx.userId);
        return row ? `Forgotten (id ${p.value.id}).` : "No such active memory to forget.";
      }
    }
  },
};

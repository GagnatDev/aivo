import { loadBudgetSnapshot } from "../agent/budget.js";
import type { HandleMessageDeps, IncomingMessage } from "./handleMessage.js";

/**
 * The character a message must start with to be treated as a control command rather
 * than conversation. A future env override is a trivial follow-up if it's ever needed.
 */
export const COMMAND_PREFIX = "!";

/** A message content parsed into a command name and its whitespace-separated args. */
export interface ParsedCommand {
  name: string;
  args: string[];
}

/**
 * Parse a message into a command, or `null` if it isn't one. Pure: trims, requires the
 * prefix, splits on whitespace, and lowercases the name. A bare `!` (no name) is not a
 * command.
 */
export function parseCommand(content: string): ParsedCommand | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith(COMMAND_PREFIX)) return null;
  const parts = trimmed.slice(COMMAND_PREFIX.length).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const [name, ...args] = parts;
  return { name: name.toLowerCase(), args };
}

/** Whether a message is a control command (and so bypasses the agent loop). */
export function isCommand(content: string): boolean {
  return parseCommand(content) !== null;
}

/** The context handed to every command handler. `isOwner` is derived server-side. */
export interface CommandContext {
  deps: HandleMessageDeps;
  userId: string;
  /** Derived from users.is_owner — never from message content. */
  isOwner: boolean;
  args: string[];
}

type CommandHandler = (ctx: CommandContext) => Promise<string>;

interface CommandDef {
  description: string;
  run: CommandHandler;
}

/**
 * The command registry. Each entry is a read-only DB operation rendered as markdown —
 * no LLM call, no cost, no budget/approval gating. Extend by adding an entry here;
 * `!help` is generated from this map so it stays in sync.
 */
const COMMANDS: Record<string, CommandDef> = {
  models: {
    description: "List the active models with their cheap/premium role and prices.",
    async run({ deps }) {
      const rows = await deps.modelPricing.listActive();
      if (rows.length === 0) return "No models are configured yet.";
      const lines = rows.map((r) => {
        const role = r.tier_role ?? "unassigned";
        const input = Number(r.input_cost_per_mtok_cents);
        const output = Number(r.output_cost_per_mtok_cents);
        return `• ${r.model_id} — ${role} — in ${input}¢ / out ${output}¢ per Mtok (${r.currency})`;
      });
      return `**Available models**\n${lines.join("\n")}`;
    },
  },
  budget: {
    description: "Show today's and month-to-date spend versus the monthly ceiling.",
    async run({ deps, userId }) {
      const snap = await loadBudgetSnapshot(deps, userId);
      const ceiling =
        snap.monthlyCeilingCents > 0 ? `${snap.monthlyCeilingCents}¢` : "no ceiling set";
      const daily = snap.dailySoftCapCents != null ? ` (soft cap ${snap.dailySoftCapCents}¢)` : "";
      return [
        "**Budget**",
        `• Today: ${round(snap.dailyCents)}¢${daily}`,
        `• Month to date: ${round(snap.monthToDateCents)}¢ of ${ceiling} (${Math.round(snap.pctOfCeiling)}%)`,
        `• State: ${snap.state}`,
      ].join("\n");
    },
  },
  settings: {
    description: "Show your current settings.",
    async run({ deps, userId }) {
      const s = await deps.settings.getOrCreate(userId);
      return [
        "**Settings**",
        `• Timezone: ${s.timezone}`,
        `• Digest hour: ${s.digest_hour}`,
        `• Digest cap: ${s.digest_cap}`,
        `• Model tier: ${s.model_tier}`,
        `• Persona prompt: ${s.persona_prompt ?? "—"}`,
      ].join("\n");
    },
  },
  help: {
    description: "List the available commands.",
    async run() {
      const lines = Object.entries(COMMANDS).map(
        ([name, def]) => `• \`${COMMAND_PREFIX}${name}\` — ${def.description}`,
      );
      return `**Commands**\n${lines.join("\n")}`;
    },
  },
};

/**
 * Dispatch a command message to its handler and return the markdown reply. The caller has
 * already confirmed {@link isCommand}. Unknown names get a friendly pointer to `!help`.
 * JIT-provisions the author (mirrors handleIncomingMessage) so user-scoped commands have a
 * userId and a server-derived isOwner. Command messages are intentionally not persisted —
 * they are out-of-band control, not conversation.
 */
export async function runCommand(deps: HandleMessageDeps, msg: IncomingMessage): Promise<string> {
  const parsed = parseCommand(msg.content);
  if (!parsed) return `Not a command. Try \`${COMMAND_PREFIX}help\`.`;

  const command = COMMANDS[parsed.name];
  if (!command) {
    return `Unknown command \`${COMMAND_PREFIX}${parsed.name}\`. Try \`${COMMAND_PREFIX}help\`.`;
  }

  const user = await deps.users.upsertByDiscordId({
    discordUserId: msg.authorId,
    displayName: msg.authorDisplayName,
    isOwner: msg.authorId === deps.ownerDiscordUserId,
  });

  return command.run({ deps, userId: user.id, isOwner: user.is_owner, args: parsed.args });
}

/** Round fractional cents for display (spend is tracked with sub-cent precision). */
function round(cents: number): number {
  return Math.round(cents * 100) / 100;
}

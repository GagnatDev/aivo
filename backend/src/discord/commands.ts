import { loadBudgetSnapshot } from "../agent/budget.js";
import { asLanguage, type Language, languageName, messages } from "../i18n/index.js";
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
  /** The user's preferred language — every rendered command output is localized. */
  lang: Language;
}

type CommandHandler = (ctx: CommandContext) => Promise<string>;

interface CommandDef {
  /** Shown by `!help`; localized so the command list reads in the user's language. */
  description: (lang: Language) => string;
  run: CommandHandler;
}

/**
 * The command registry. Each entry is a read-only DB operation rendered as localized
 * markdown — no LLM call, no cost, no budget/approval gating. Extend by adding an entry
 * here; `!help` is generated from this map so it stays in sync. Command names stay
 * English (they are the typed `!` tokens); only the rendered output is translated.
 */
const COMMANDS: Record<string, CommandDef> = {
  models: {
    description: (lang) => messages(lang).commands.descModels,
    async run({ deps, lang }) {
      const c = messages(lang).commands;
      const [rows, assignments] = await Promise.all([
        deps.modelPricing.listActive(),
        deps.modelPricing.listAssignments(),
      ]);
      if (rows.length === 0) return c.noModels;
      const lines = rows.map((r) => {
        const roles = assignments
          .filter((a) => a.model_id === r.model_id)
          .map((a) => `${a.capability}:${a.tier_role}`);
        const role = roles.length > 0 ? roles.join(", ") : c.unassigned;
        const input = Number(r.input_cost_per_mtok_cents);
        const output = Number(r.output_cost_per_mtok_cents);
        const cached =
          r.cached_input_cost_per_mtok_cents != null
            ? ` ${c.cachedPrice(Number(r.cached_input_cost_per_mtok_cents))}`
            : "";
        const audio =
          r.audio_cost_per_min_cents != null
            ? `, audio ${Number(r.audio_cost_per_min_cents)}¢/min`
            : "";
        return `• ${r.model_id} — ${role} — in ${input}¢${cached} / out ${output}¢ per Mtok${audio} (${r.currency})`;
      });
      return `${c.modelsTitle}\n${lines.join("\n")}`;
    },
  },
  budget: {
    description: (lang) => messages(lang).commands.descBudget,
    async run({ deps, userId, lang }) {
      const c = messages(lang).commands;
      const snap = await loadBudgetSnapshot(deps, userId);
      const ceiling = snap.monthlyCeilingCents > 0 ? `${snap.monthlyCeilingCents}¢` : c.noCeiling;
      const daily =
        snap.dailySoftCapCents != null ? ` (${c.softCap(`${snap.dailySoftCapCents}¢`)})` : "";
      return [
        c.budgetTitle,
        `• ${c.budgetToday}: ${round(snap.dailyCents)}¢${daily}`,
        `• ${c.budgetMonthToDate}: ${round(snap.monthToDateCents)}¢ of ${ceiling} (${Math.round(snap.pctOfCeiling)}%)`,
        `• ${c.budgetState}: ${snap.state}`,
      ].join("\n");
    },
  },
  settings: {
    description: (lang) => messages(lang).commands.descSettings,
    async run({ deps, userId, lang }) {
      const c = messages(lang).commands;
      const s = await deps.settings.getOrCreate(userId);
      return [
        c.settingsTitle,
        `• ${c.settingsTimezone}: ${s.timezone}`,
        `• ${c.settingsDigestHour}: ${s.digest_hour}`,
        `• ${c.settingsDigestCap}: ${s.digest_cap}`,
        `• ${c.settingsModelTier}: ${s.model_tier}`,
        `• ${c.settingsLanguage}: ${languageName(s.language)}`,
        `• ${c.settingsPersona}: ${s.persona_prompt ?? "—"}`,
      ].join("\n");
    },
  },
  help: {
    description: (lang) => messages(lang).commands.descHelp,
    async run({ lang }) {
      const lines = Object.entries(COMMANDS).map(
        ([name, def]) => `• \`${COMMAND_PREFIX}${name}\` — ${def.description(lang)}`,
      );
      return `${messages(lang).commands.commandsTitle}\n${lines.join("\n")}`;
    },
  },
};

/**
 * Dispatch a command message to its handler and return the markdown reply. The caller has
 * already confirmed {@link isCommand}. Unknown names get a friendly pointer to `!help`.
 * JIT-provisions the author (mirrors handleIncomingMessage) so user-scoped commands have a
 * userId, a server-derived isOwner, and a resolved language. Command messages are
 * intentionally not persisted — they are out-of-band control, not conversation.
 */
export async function runCommand(deps: HandleMessageDeps, msg: IncomingMessage): Promise<string> {
  const parsed = parseCommand(msg.content);

  const user = await deps.users.upsertByDiscordId({
    discordUserId: msg.authorId,
    displayName: msg.authorDisplayName,
    isOwner: msg.authorId === deps.ownerDiscordUserId,
  });
  const settings = await deps.settings.getOrCreate(user.id);
  const lang = asLanguage(settings.language);
  const c = messages(lang).commands;

  if (!parsed) return c.notACommand;

  const command = COMMANDS[parsed.name];
  if (!command) return c.unknownCommand(parsed.name);

  return command.run({ deps, userId: user.id, isOwner: user.is_owner, args: parsed.args, lang });
}

/** Round fractional cents for display (spend is tracked with sub-cent precision). */
function round(cents: number): number {
  return Math.round(cents * 100) / 100;
}

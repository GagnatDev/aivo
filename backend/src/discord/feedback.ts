import type { AgentDeps } from "../agent/deps.js";
import type { FeedbackSignal } from "../db/schema.enums.js";
import { asLanguage, type Language, messages } from "../i18n/index.js";
import { FEEDBACK_PREFIX } from "./digestDelivery.js";

/**
 * Resolve a digest feedback-button click (customId `fb:<signal>:<digest_item_id>`)
 * against the database. Discord-thin (no interaction object) so it's unit-testable;
 * the gateway applies the returned ack as an ephemeral reply. The click is attributed
 * to the clicking user (JIT-provisioned like any inbound message) and folded into the
 * interest profile by the next digest run.
 */

const BUTTON_SIGNALS = new Set<FeedbackSignal>(["keep", "drop", "too_long", "wrong_topic"]);

/** The ack for a feedback signal, in the given language. */
function ackFor(signal: FeedbackSignal, lang: Language): string {
  const f = messages(lang).feedback;
  switch (signal) {
    case "keep":
      return f.keep;
    case "drop":
      return f.drop;
    case "too_long":
      return f.tooLong;
    case "wrong_topic":
      return f.wrongTopic;
    default:
      return f.noted;
  }
}

export interface FeedbackClick {
  customId: string;
  clickerDiscordId: string;
  clickerDisplayName: string | null;
}

/** Handle a feedback click; null when the customId isn't a feedback button. */
export async function resolveFeedbackClick(
  deps: AgentDeps,
  click: FeedbackClick,
): Promise<{ ack: string } | null> {
  const [prefix, signal, itemId] = click.customId.split(":");
  if (prefix !== FEEDBACK_PREFIX || !itemId) return null;
  if (!BUTTON_SIGNALS.has(signal as FeedbackSignal)) return null;

  const user = await deps.users.upsertByDiscordId({
    discordUserId: click.clickerDiscordId,
    displayName: click.clickerDisplayName,
    isOwner: click.clickerDiscordId === deps.ownerDiscordUserId,
  });
  const settings = await deps.settings.getOrCreate(user.id);
  const lang = asLanguage(settings.language);

  const item = await deps.digestItems.findById(itemId);
  if (!item) return { ack: messages(lang).feedback.gone };

  await deps.feedback.insert({
    userId: user.id,
    digestItemId: itemId,
    signal: signal as FeedbackSignal,
  });
  return { ack: ackFor(signal as FeedbackSignal, lang) };
}

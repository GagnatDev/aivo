import type { Messages } from "./messages.js";

/** English (`en`) catalog. See {@link Messages} for the contract. */
export const en: Messages = {
  feedback: {
    keep: "Noted — more like this.",
    drop: "Noted — fewer like this.",
    tooLong: "Noted — I'll favour shorter ones.",
    wrongTopic: "Noted — wrong topic, I'll recalibrate.",
    noted: "Noted.",
    gone: "That digest entry is gone — feedback not recorded.",
  },

  reminder: {
    btn10m: "😴 10 min",
    btn1h: "😴 1 hour",
    btnTomorrow: "😴 Tomorrow",
    label: "⏰ **Reminder:**",
    gone: "That reminder is gone — nothing to snooze.",
    cancelled: "That reminder was cancelled.",
    someoneElse: "That's someone else's reminder — only they can snooze it.",
    snoozed: (when) => `Snoozed — I'll remind you again ${when}.`,
    inTenMinutes: "in 10 minutes",
    inOneHour: "in 1 hour",
    tomorrowAt: (hhmm) => `tomorrow at ${hhmm}`,
  },

  digest: {
    btnKeep: "👍 Keep",
    btnDrop: "👎 Drop",
    btnTooLong: "⏱ Too long",
    btnWrongTopic: "🚫 Wrong topic",
    headerEmpty: (runDate) => `**YouTube digest — ${runDate}**: nothing new worth your time. 🎉`,
    header: (runDate, picks) =>
      `**YouTube digest — ${runDate}** · ${picks} pick${picks === 1 ? "" : "s"}`,
    headerWithUpcoming: (runDate, picks, upcoming) =>
      `**YouTube digest — ${runDate}** · ${picks} pick${picks === 1 ? "" : "s"}` +
      ` · ${upcoming} coming up`,
    headerUpcomingOnly: (runDate, upcoming) =>
      `**YouTube digest — ${runDate}** · ${upcoming} coming up (not released yet)`,
    morePicks: (count) =>
      `*(${count} more matched with lower confidence — ask me to "show more picks".)*`,
    budgetNote: (pct) => `*(Budget: you've used about ${pct}% of this month's ceiling.)*`,
    why: (text) => `*Why: ${text}*`,
    durationPrefix: (minutes) => `${minutes} min · `,
    upcomingHeader: "**Coming up — not released yet:**",
    releasesAt: (when) => `Releases ${when}`,
    notReleasedYet: "Not released yet · ",
    rejectedHeader: "**Also new, but skipped** *(correct me if I got one wrong)*:",
    rejectedLine: (title, channel, reason) =>
      `• ${title}${channel ? ` (${channel})` : ""} — skipped: ${reason}`,
    noProfileNudge:
      "I couldn't build your YouTube digest yet — I don't know your interests. " +
      'Tell me what you like watching (e.g. "set up my YouTube interests: hand-tool ' +
      'woodworking, no shorts") and I\'ll start tomorrow morning — or say "run the digest now".',
    skippedBudgetNote:
      "I skipped today's YouTube digest to stay inside your budget — direct chat still works. " +
      'Raise the budget or say "run the digest now" to override.',
    runFailedNote: (detail) =>
      `⚠️ I couldn't finish today's YouTube digest — ${detail}. I'll try again at the next ` +
      'scheduled run; say "run the digest now" to retry sooner.',
    runFailedYoutubeAuthNote: (detail) =>
      "⚠️ I couldn't build your YouTube digest: my access to your YouTube account has expired " +
      `or been revoked (${detail}). Reconnect it — the dashboard's Digest History page has the ` +
      'steps — then say "run the digest now".',
    reasonNotFit: "not a fit today",
    reasonLowMatch: "low match to your interests",
    reasonCouldntProcess: "couldn't process this one",
  },

  weather: {
    noHomeNudge:
      "I'd send your morning weather report, but no home location is set. " +
      'Tell me where you live (e.g. "add my home: Trondheim" then "set Trondheim as home").',
    reportError: (message) =>
      `I couldn't put together this morning's weather report — the forecast service was unreachable (${message}). I'll try again tomorrow.`,
    morningHeader: (place, day) => `🌅 **Good morning! Weather for ${place} — ${day}**`,
    morningNoForecast: (place) => `I couldn't read a forecast for ${place} right now.`,
    now: "Now",
    today: "Today",
    tomorrow: "Tomorrow",
    wind: "wind",
    symbols: {
      clearsky: "Clear sky",
      fair: "Fair",
      partlycloudy: "Partly cloudy",
      cloudy: "Cloudy",
      fog: "Fog",
      lightrainshowers: "Light rain showers",
      rainshowers: "Rain showers",
      heavyrainshowers: "Heavy rain showers",
      lightrain: "Light rain",
      rain: "Rain",
      heavyrain: "Heavy rain",
      lightsleetshowers: "Light sleet showers",
      sleetshowers: "Sleet showers",
      heavysleetshowers: "Heavy sleet showers",
      lightsleet: "Light sleet",
      sleet: "Sleet",
      heavysleet: "Heavy sleet",
      lightsnowshowers: "Light snow showers",
      snowshowers: "Snow showers",
      heavysnowshowers: "Heavy snow showers",
      lightsnow: "Light snow",
      snow: "Snow",
      heavysnow: "Heavy snow",
    },
    withThunder: (label) => `${label} with thunder`,
    summaryHeader: (place, updated) => `Forecast for ${place} (updated ${updated}):`,
    summaryNoData: (place) => `No forecast data available for ${place}.`,
    summaryNextHours: "Next hours:",
    summaryDays: "Days:",
  },

  commands: {
    notACommand: "Not a command. Try `!help`.",
    unknownCommand: (name) => `Unknown command \`!${name}\`. Try \`!help\`.`,
    descModels: "List the active models with the tier slots they fill and their prices.",
    descBudget: "Show today's and month-to-date spend versus the monthly ceiling.",
    descSettings: "Show your current settings.",
    descHelp: "List the available commands.",
    noModels: "No models are configured yet.",
    unassigned: "unassigned",
    modelsTitle: "**Available models**",
    budgetTitle: "**Budget**",
    budgetToday: "Today",
    budgetMonthToDate: "Month to date",
    budgetState: "State",
    noCeiling: "no ceiling set",
    softCap: (cents) => `soft cap ${cents}`,
    settingsTitle: "**Settings**",
    settingsTimezone: "Timezone",
    settingsDigestHour: "Digest hour",
    settingsDigestCap: "Digest cap",
    settingsModelTier: "Model tier",
    settingsLanguage: "Language",
    settingsPersona: "Persona prompt",
    commandsTitle: "**Commands**",
  },

  approval: {
    approve: "Approve",
    cancel: "Cancel",
    prompt: (estimateCents, thresholdCents) =>
      `This looks like it'll cost about ${estimateCents}¢, over your ` +
      `${thresholdCents}¢ approval threshold. Approve to go ahead?`,
    noLongerAvailable: "This request is no longer available.",
    onlyRequester: "Only the person who made this request can respond to it.",
    alreadyExpired: "This request already expired.",
    cancelled: "Cancelled — I didn't run it.",
    expiredAskAgain: "This request expired — just ask again.",
    couldntPickUp: "I couldn't pick that request back up — ask again.",
    couldntFinish: "I couldn't finish that one — ask again.",
    approved: "Approved.",
  },

  budget: {
    alert: (pct) => `*(Budget: you've used about ${pct}% of this month's ceiling.)*`,
    overBudgetNote:
      "Heads up — you're over this month's budget, so I'm keeping this brief and on the cheap model.",
    offlineAck: (duration) => `*(I was offline for ${duration} — catching up now.)*`,
    minutes: (n) => `${n} min`,
    hours: (n) => `${n} h`,
    days: (n) => `${n} d`,
  },

  transcription: {
    tooLong: (capSecs) =>
      `That voice note is a bit long for me — I cap voice messages at about ${capSecs} ` +
      "seconds for now. Mind sending a shorter one, or typing it out?",
    tooBig:
      "That voice note is a little too large for me to handle right now — mind sending a shorter one, or typing it out?",
    noModel:
      "I can't transcribe voice messages yet — the owner needs to configure an audio model in the model/pricing config.",
    failed:
      "Sorry — I couldn't make out that voice message just now. Please try again, or type it out.",
  },

  errors: {
    noModelConfigured:
      "I have no model configured yet — ask the owner to set up the model/pricing config.",
    emptyReply: "I don't have anything to add to that.",
    llmError: "Sorry — I couldn't reach the language model just now. Please try again in a moment.",
    llmRateLimit: "Sorry — the language model is busy right now. Please try again in a moment.",
    llmAuth:
      "Sorry — I can't reach the language model because of a credentials problem. " +
      "The owner needs to check the API configuration.",
    stuck: "I got a bit tangled working through that — can you rephrase?",
    costCeilingNote:
      "\n\n(I wrapped that up early — this turn was getting expensive. Ask again if you want me to dig deeper.)",
    truncationNote: "\n\n(…that got cut off by my reply-length limit.)",
    handlingProblem: "Sorry — I ran into a problem handling that. Please try again.",
    interactionProblem: "Sorry — I ran into a problem with that. Please try again.",
  },
};

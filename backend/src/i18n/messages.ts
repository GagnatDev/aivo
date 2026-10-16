/**
 * The shape every language catalog must implement. One entry per verbatim-sent,
 * code-generated user-facing string in the app — Discord button labels, `!` command
 * output, digest/reminder/weather delivery text, approval prompts, budget notes and
 * error fallbacks. Entries are plain strings, or functions when a value is interpolated.
 *
 * NOT here: text the LLM writes (its language is steered by the system-prompt directive,
 * see i18n#languageDirective and agent/context.ts) and tool-result strings the model
 * consumes and re-renders in the user's language (translating those would be invisible).
 *
 * `en.ts` and `nb.ts` implement this interface, so a missing or misspelled key is a
 * compile error and the two languages can never silently drift apart.
 */
export interface Messages {
  /** Digest feedback-button acks (ephemeral replies to a button click). */
  feedback: {
    keep: string;
    drop: string;
    tooLong: string;
    wrongTopic: string;
    /** Generic fallback ack. */
    noted: string;
    /** The digest item the click referenced is gone. */
    gone: string;
  };

  /** Reminder snooze buttons + delivery. */
  reminder: {
    /** Snooze button labels. */
    btn10m: string;
    btn1h: string;
    btnTomorrow: string;
    /** The "⏰ Reminder:" prefix on a delivered reminder. */
    label: string;
    gone: string;
    cancelled: string;
    someoneElse: string;
    /** "Snoozed — I'll remind you again <when>." */
    snoozed: (when: string) => string;
    /** The <when> phrase pieces used by `snoozed`. */
    inTenMinutes: string;
    inOneHour: string;
    tomorrowAt: (hhmm: string) => string;
  };

  /** YouTube digest delivery (#youtube). */
  digest: {
    btnKeep: string;
    btnDrop: string;
    btnTooLong: string;
    btnWrongTopic: string;
    /** Header when nothing was picked. */
    headerEmpty: (runDate: string) => string;
    /** Header with a pick count. */
    header: (runDate: string, picks: number) => string;
    /** Header when some picks are still unreleased (premieres / scheduled uploads). */
    headerWithUpcoming: (runDate: string, picks: number, upcoming: number) => string;
    /** Header when every pick is still unreleased. */
    headerUpcomingOnly: (runDate: string, upcoming: number) => string;
    morePicks: (count: number) => string;
    budgetNote: (pct: number) => string;
    /** "Why:" label prefixing a pick's rationale. */
    why: (text: string) => string;
    /** "N min · " duration prefix on a pick embed. */
    durationPrefix: (minutes: number) => string;
    /** Section header above unreleased picks. */
    upcomingHeader: string;
    /** Leading line on an unreleased pick: "Releases <when>". */
    releasesAt: (when: string) => string;
    /** Footer lead-in for an unreleased pick (replaces the duration prefix). */
    notReleasedYet: string;
    /** Header of the "also new, but skipped" list. */
    rejectedHeader: string;
    /** "<title> (<channel>) — skipped: <reason>" line. */
    rejectedLine: (title: string, channel: string | null, reason: string) => string;
    noProfileNudge: string;
    skippedBudgetNote: string;
    /** The run failed; `detail` is the recorded technical reason. */
    runFailedNote: (detail: string) => string;
    /** The run failed because the YouTube connection needs re-authorizing. */
    runFailedYoutubeAuthNote: (detail: string) => string;
    /** Fallback reject reasons (used when the LLM verdict gave none). */
    reasonNotFit: string;
    reasonLowMatch: string;
    reasonCouldntProcess: string;
  };

  /**
   * Weather: the verbatim daily morning report, plus the shared condition labels and
   * the chat-tool forecast summary. The summary is a tool result the model relays, but
   * it shares `symbolLabel`/`currentLine`/`dayLine` with the verbatim report, so the
   * whole module is localized together rather than left half-translated.
   */
  weather: {
    noHomeNudge: string;
    reportError: (message: string) => string;
    /** "🌅 Good morning! Weather for <place> — <day>" */
    morningHeader: (place: string, day: string) => string;
    morningNoForecast: (place: string) => string;
    /** Section labels (rendered bold in the morning report). */
    now: string;
    today: string;
    tomorrow: string;
    /** ", wind" segment lead-in for the current-conditions line. */
    wind: string;
    /** MET symbol code → friendly condition label. */
    symbols: Record<string, string>;
    /** Appended to a label for thunder variants, e.g. "Rain with thunder". */
    withThunder: (label: string) => string;
    /** Chat-tool forecast summary scaffolding. */
    summaryHeader: (place: string, updated: string) => string;
    summaryNoData: (place: string) => string;
    summaryNextHours: string;
    summaryDays: string;
  };

  /** `!` control commands (bypass the LLM; rendered as markdown). */
  commands: {
    notACommand: string;
    unknownCommand: (name: string) => string;
    descModels: string;
    descBudget: string;
    descSettings: string;
    descHelp: string;
    noModels: string;
    unassigned: string;
    modelsTitle: string;
    /** Parenthetical cached-input price on `!models`, e.g. "(cached 8¢)". */
    cachedPrice: (cents: number) => string;
    budgetTitle: string;
    budgetToday: string;
    budgetMonthToDate: string;
    budgetState: string;
    noCeiling: string;
    softCap: (cents: string) => string;
    settingsTitle: string;
    settingsTimezone: string;
    settingsDigestHour: string;
    settingsDigestCap: string;
    settingsModelTier: string;
    settingsLanguage: string;
    settingsPersona: string;
    commandsTitle: string;
  };

  /** Approval gate: buttons, the prompt, and the outcome updates. */
  approval: {
    approve: string;
    cancel: string;
    prompt: (estimateCents: number, thresholdCents: number) => string;
    noLongerAvailable: string;
    onlyRequester: string;
    alreadyExpired: string;
    cancelled: string;
    expiredAskAgain: string;
    couldntPickUp: string;
    /** The resumed turn was abandoned mid-run (shutdown) instead of finishing. */
    couldntFinish: string;
    approved: string;
  };

  /** Budget alert + over-budget + offline notes prefixed onto replies. */
  budget: {
    alert: (pct: number) => string;
    overBudgetNote: string;
    /** "(I was offline for <duration> — catching up now.)" */
    offlineAck: (duration: string) => string;
    /** Duration units used by `offlineAck`. */
    minutes: (n: number) => string;
    hours: (n: number) => string;
    days: (n: number) => string;
  };

  /** Voice-message replies (short-circuit, no LLM). */
  transcription: {
    tooLong: (capSecs: number) => string;
    tooBig: string;
    noModel: string;
    failed: string;
  };

  /** Turn-level fallbacks sent verbatim when the LLM can't produce a reply. */
  errors: {
    noModelConfigured: string;
    emptyReply: string;
    llmError: string;
    llmRateLimit: string;
    llmAuth: string;
    stuck: string;
    costCeilingNote: string;
    truncationNote: string;
    /** Last-resort catch-all replies from the gateway (client.ts). */
    handlingProblem: string;
    interactionProblem: string;
  };
}

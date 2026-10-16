import type { Messages } from "./messages.js";

/** Norwegian Bokmål (`nb`) catalog. See {@link Messages} for the contract. */
export const nb: Messages = {
  feedback: {
    keep: "Notert — mer av dette.",
    drop: "Notert — mindre av dette.",
    tooLong: "Notert — jeg prioriterer kortere.",
    wrongTopic: "Notert — feil tema, jeg justerer.",
    noted: "Notert.",
    gone: "Den digest-oppføringen er borte — tilbakemeldingen ble ikke lagret.",
  },

  reminder: {
    btn10m: "😴 10 min",
    btn1h: "😴 1 time",
    btnTomorrow: "😴 I morgen",
    label: "⏰ **Påminnelse:**",
    gone: "Den påminnelsen er borte — ingenting å utsette.",
    cancelled: "Den påminnelsen ble avlyst.",
    someoneElse: "Det er noen andres påminnelse — bare de kan utsette den.",
    snoozed: (when) => `Utsatt — jeg minner deg på nytt ${when}.`,
    inTenMinutes: "om 10 minutter",
    inOneHour: "om 1 time",
    tomorrowAt: (hhmm) => `i morgen kl. ${hhmm}`,
  },

  digest: {
    btnKeep: "👍 Behold",
    btnDrop: "👎 Forkast",
    btnTooLong: "⏱ For lang",
    btnWrongTopic: "🚫 Feil tema",
    headerEmpty: (runDate) => `**YouTube-digest — ${runDate}**: ingenting nytt verdt tiden din. 🎉`,
    header: (runDate, picks) => `**YouTube-digest — ${runDate}** · ${picks} treff`,
    headerWithUpcoming: (runDate, picks, upcoming) =>
      `**YouTube-digest — ${runDate}** · ${picks} treff · ${upcoming} kommer`,
    headerUpcomingOnly: (runDate, upcoming) =>
      `**YouTube-digest — ${runDate}** · ${upcoming} kommer (ikke sluppet ennå)`,
    morePicks: (count) =>
      `*(${count} til traff med lavere sikkerhet — be meg om å "vise flere treff".)*`,
    budgetNote: (pct) => `*(Budsjett: du har brukt omtrent ${pct} % av månedens tak.)*`,
    why: (text) => `*Hvorfor: ${text}*`,
    durationPrefix: (minutes) => `${minutes} min · `,
    upcomingHeader: "**Kommer — ikke sluppet ennå:**",
    releasesAt: (when) => `Slippes ${when}`,
    notReleasedYet: "Ikke sluppet ennå · ",
    rejectedHeader: "**Også nytt, men hoppet over** *(rett meg hvis jeg tok feil av noe)*:",
    rejectedLine: (title, channel, reason) =>
      `• ${title}${channel ? ` (${channel})` : ""} — hoppet over: ${reason}`,
    noProfileNudge:
      "Jeg fikk ikke laget YouTube-digesten din ennå — jeg vet ikke hva du er interessert i. " +
      "Fortell meg hva du liker å se på (f.eks. «sett opp YouTube-interessene mine: " +
      "håndverktøy-trearbeid, ingen shorts»), så starter jeg i morgen tidlig — eller si «kjør digesten nå».",
    skippedBudgetNote:
      "Jeg hoppet over dagens YouTube-digest for å holde meg innenfor budsjettet — vanlig chat fungerer fortsatt. " +
      "Øk budsjettet eller si «kjør digesten nå» for å overstyre.",
    runFailedNote: (detail) =>
      `⚠️ Jeg fikk ikke fullført dagens YouTube-digest — ${detail}. Jeg prøver igjen ved neste ` +
      "planlagte kjøring; si «kjør digesten nå» for å prøve før det.",
    runFailedYoutubeAuthNote: (detail) =>
      "⚠️ Jeg fikk ikke laget YouTube-digesten din: tilgangen min til YouTube-kontoen din har " +
      `utløpt eller blitt trukket tilbake (${detail}). Koble den til på nytt — siden ` +
      "«Digest History» i dashbordet forklarer hvordan — og si deretter «kjør digesten nå».",
    reasonNotFit: "passer ikke i dag",
    reasonLowMatch: "svak match mot interessene dine",
    reasonCouldntProcess: "klarte ikke å behandle denne",
  },

  weather: {
    noHomeNudge:
      "Jeg ville sendt morgenværrapporten din, men ingen hjemsted er satt. " +
      "Fortell meg hvor du bor (f.eks. «legg til hjemmet mitt: Trondheim» og deretter «sett Trondheim som hjem»).",
    reportError: (message) =>
      `Jeg klarte ikke å sette sammen morgenens værrapport — værtjenesten var utilgjengelig (${message}). Jeg prøver igjen i morgen.`,
    morningHeader: (place, day) => `🌅 **God morgen! Vær for ${place} — ${day}**`,
    morningNoForecast: (place) => `Jeg klarte ikke å lese en værmelding for ${place} akkurat nå.`,
    now: "Nå",
    today: "I dag",
    tomorrow: "I morgen",
    wind: "vind",
    symbols: {
      clearsky: "Klarvær",
      fair: "Lettskyet",
      partlycloudy: "Delvis skyet",
      cloudy: "Skyet",
      fog: "Tåke",
      lightrainshowers: "Lette regnbyger",
      rainshowers: "Regnbyger",
      heavyrainshowers: "Kraftige regnbyger",
      lightrain: "Lett regn",
      rain: "Regn",
      heavyrain: "Kraftig regn",
      lightsleetshowers: "Lette sluddbyger",
      sleetshowers: "Sluddbyger",
      heavysleetshowers: "Kraftige sluddbyger",
      lightsleet: "Lett sludd",
      sleet: "Sludd",
      heavysleet: "Kraftig sludd",
      lightsnowshowers: "Lette snøbyger",
      snowshowers: "Snøbyger",
      heavysnowshowers: "Kraftige snøbyger",
      lightsnow: "Lett snø",
      snow: "Snø",
      heavysnow: "Kraftig snø",
    },
    withThunder: (label) => `${label} med torden`,
    summaryHeader: (place, updated) => `Værmelding for ${place} (oppdatert ${updated}):`,
    summaryNoData: (place) => `Ingen værdata tilgjengelig for ${place}.`,
    summaryNextHours: "Neste timer:",
    summaryDays: "Dager:",
  },

  commands: {
    notACommand: "Ikke en kommando. Prøv `!help`.",
    unknownCommand: (name) => `Ukjent kommando \`!${name}\`. Prøv \`!help\`.`,
    descModels: "List opp de aktive modellene med hvilke nivåer de fyller og prisene deres.",
    descBudget: "Vis dagens og hittil-i-måneden-forbruk mot månedstaket.",
    descSettings: "Vis de nåværende innstillingene dine.",
    descHelp: "List opp tilgjengelige kommandoer.",
    noModels: "Ingen modeller er konfigurert ennå.",
    unassigned: "ikke tildelt",
    modelsTitle: "**Tilgjengelige modeller**",
    cachedPrice: (cents) => `(bufret ${cents}¢)`,
    budgetTitle: "**Budsjett**",
    budgetToday: "I dag",
    budgetMonthToDate: "Hittil i måneden",
    budgetState: "Tilstand",
    noCeiling: "ingen tak satt",
    softCap: (cents) => `mykt tak ${cents}`,
    settingsTitle: "**Innstillinger**",
    settingsTimezone: "Tidssone",
    settingsDigestHour: "Digest-time",
    settingsDigestCap: "Digest-tak",
    settingsModelTier: "Modellnivå",
    settingsLanguage: "Språk",
    settingsPersona: "Persona-tekst",
    commandsTitle: "**Kommandoer**",
  },

  approval: {
    approve: "Godkjenn",
    cancel: "Avbryt",
    prompt: (estimateCents, thresholdCents) =>
      `Dette ser ut til å koste omtrent ${estimateCents}¢, over godkjenningsgrensen din på ` +
      `${thresholdCents}¢. Godkjenn for å gå videre?`,
    noLongerAvailable: "Denne forespørselen er ikke lenger tilgjengelig.",
    onlyRequester: "Bare personen som la inn denne forespørselen kan svare på den.",
    alreadyExpired: "Denne forespørselen er allerede utløpt.",
    cancelled: "Avbrutt — jeg kjørte den ikke.",
    expiredAskAgain: "Denne forespørselen utløp — bare spør på nytt.",
    couldntPickUp: "Jeg klarte ikke å ta opp igjen den forespørselen — spør på nytt.",
    couldntFinish: "Jeg ble ikke ferdig med den — spør på nytt.",
    approved: "Godkjent.",
  },

  budget: {
    alert: (pct) => `*(Budsjett: du har brukt omtrent ${pct} % av månedens tak.)*`,
    overBudgetNote:
      "Bare så du vet — du er over månedens budsjett, så jeg holder dette kort og på den billige modellen.",
    offlineAck: (duration) => `*(Jeg var frakoblet i ${duration} — tar igjen nå.)*`,
    minutes: (n) => `${n} min`,
    hours: (n) => `${n} t`,
    days: (n) => `${n} d`,
  },

  transcription: {
    tooLong: (capSecs) =>
      `Den talemeldingen er litt lang for meg — jeg begrenser talemeldinger til omtrent ${capSecs} ` +
      "sekunder foreløpig. Kan du sende en kortere, eller skrive det ned?",
    tooBig:
      "Den talemeldingen er litt for stor for meg akkurat nå — kan du sende en kortere, eller skrive det ned?",
    noModel:
      "Jeg kan ikke transkribere talemeldinger ennå — eieren må konfigurere en lydmodell i modell-/priskonfigurasjonen.",
    failed:
      "Beklager — jeg fikk ikke tak i den talemeldingen akkurat nå. Prøv igjen, eller skriv det ned.",
  },

  errors: {
    noModelConfigured:
      "Jeg har ingen modell konfigurert ennå — be eieren om å sette opp modell-/priskonfigurasjonen.",
    emptyReply: "Jeg har ikke noe å legge til der.",
    llmError:
      "Beklager — jeg fikk ikke kontakt med språkmodellen akkurat nå. Prøv igjen om et øyeblikk.",
    llmRateLimit: "Beklager — språkmodellen er opptatt akkurat nå. Prøv igjen om et øyeblikk.",
    llmAuth:
      "Beklager — jeg får ikke kontakt med språkmodellen på grunn av et legitimasjonsproblem. " +
      "Eieren må sjekke API-konfigurasjonen.",
    stuck: "Jeg gikk litt i surr med det — kan du omformulere?",
    costCeilingNote:
      "\n\n(Jeg avsluttet det tidlig — denne runden ble dyr. Spør igjen hvis du vil at jeg skal grave dypere.)",
    truncationNote: "\n\n(…det ble kuttet av grensen for svarlengde.)",
    handlingProblem: "Beklager — jeg støtte på et problem med å håndtere det. Prøv igjen.",
    interactionProblem: "Beklager — jeg støtte på et problem med det. Prøv igjen.",
  },
};

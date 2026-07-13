import { logger } from "../logger.js";
import { LlmProviderError } from "../llm/errors.js";
import { preCallCheck, recordTranscriptionUsage } from "./budget.js";
import type { AgentDeps } from "./deps.js";

/**
 * A Discord voice message normalized to plain data — no discord.js types, so the agent
 * layer stays transport-agnostic (the gateway builds this in discord/router.ts). Discord
 * attaches the duration and byte size up front, letting us enforce caps before spending a
 * byte on a download.
 */
export interface VoiceAttachment {
  /** CDN URL of the audio file. */
  url: string;
  /** MIME type, e.g. `audio/ogg`. */
  contentType: string;
  /** Clip length in seconds (Discord-reported); 0 if unknown. */
  durationSecs: number;
  /** File size in bytes (Discord-reported). */
  sizeBytes: number;
  /** File name, extension used by the provider to detect the format. */
  filename: string;
}

/**
 * The result of turning a voice message into text. `ok` carries the transcript (and any
 * budget alert crossed while metering the STT cost) for the caller to run a normal agent
 * turn on; `rejected`/`unavailable` carry a ready-to-send friendly reply and mean no
 * agent turn should run.
 */
export type TranscriptionOutcome =
  | { kind: "ok"; text: string; model: string; alertPct?: number }
  | { kind: "rejected"; reply: string }
  | { kind: "unavailable"; reply: string };

const TOO_LONG = (capSecs: number): string =>
  `That voice note is a bit long for me — I cap voice messages at about ${Math.round(
    capSecs,
  )} seconds for now. Mind sending a shorter one, or typing it out?`;
const TOO_BIG =
  "That voice note is a little too large for me to handle right now — mind sending a shorter one, or typing it out?";
const NO_MODEL =
  "I can't transcribe voice messages yet — the owner needs to configure an audio model in the model/pricing config.";
const STT_FAILED =
  "Sorry — I couldn't make out that voice message just now. Please try again, or type it out.";

/** Default byte fetcher — swapped in tests. */
async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`voice download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Resolve the audio-capable model for a tier, falling back to the other tier so a single
 * configured audio model still works. Returns null when no audio model is configured at
 * all (the caller reports it as `unavailable`). Mirrors prepareTurn.ts#resolveModel, but
 * for the `audio` capability rather than `chat`.
 */
async function resolveAudioModel(
  deps: AgentDeps,
  tier: "cheap" | "premium",
): Promise<string | null> {
  const row = await deps.modelPricing.getByTier(tier, "audio");
  if (row) return row.model_id;
  const fallback = await deps.modelPricing.getByTier(
    tier === "cheap" ? "premium" : "cheap",
    "audio",
  );
  if (fallback) {
    logger.warn(
      { requestedTier: tier, fallbackModel: fallback.model_id },
      "no audio model for requested tier; falling back",
    );
    return fallback.model_id;
  }
  return null;
}

/**
 * Transcribe a Discord voice message to text, enforcing the size/duration caps and
 * metering the cost. Requests the cheap audio tier outright (voxtral — cheapest AND
 * strongest, so there is nothing to degrade to), while still running the budget
 * pre-check so degradation state is persisted. `download` is injectable for tests.
 */
export async function transcribeVoiceMessage(
  deps: AgentDeps,
  userId: string,
  voice: VoiceAttachment,
  download: (url: string) => Promise<Buffer> = fetchBytes,
): Promise<TranscriptionOutcome> {
  // Cap checks first — Discord's metadata lets us reject before any download or spend.
  if (voice.durationSecs > deps.config.voiceMaxDurationSecs) {
    return { kind: "rejected", reply: TOO_LONG(deps.config.voiceMaxDurationSecs) };
  }
  if (voice.sizeBytes > deps.config.voiceMaxBytes) {
    return { kind: "rejected", reply: TOO_BIG };
  }

  // Transcription always asks for the cheap audio slot: voxtral is both the cheapest
  // audio model per minute (~10x under whisper) and the stronger transcriber, so
  // cheap-first is also best-first (the seed points both audio slots at it). preCallCheck
  // still runs so the degradation state is persisted; a budget coercion is a no-op on an
  // already-cheap request, and resolveAudioModel falls back to the premium slot if the
  // cheap one is ever unassigned.
  const decision = await preCallCheck(deps, userId, "cheap");
  const model = await resolveAudioModel(deps, decision.coercedTier);
  if (!model) return { kind: "unavailable", reply: NO_MODEL };

  let bytes: Buffer;
  try {
    bytes = await download(voice.url);
  } catch (err) {
    logger.error({ err }, "voice message download failed");
    return { kind: "unavailable", reply: STT_FAILED };
  }
  // Defense-in-depth: re-check the actual byte length after download (the Discord-reported
  // size drives the pre-download reject; this guards a mismatch).
  if (bytes.byteLength > deps.config.voiceMaxBytes) {
    return { kind: "rejected", reply: TOO_BIG };
  }

  let text: string;
  let durationSeconds: number;
  try {
    const res = await deps.llm.transcribe({
      model,
      audio: bytes,
      filename: voice.filename,
      contentType: voice.contentType,
    });
    text = res.text.trim();
    durationSeconds = res.durationSeconds ?? voice.durationSecs;
  } catch (err) {
    // The LLM taxonomy already distinguishes transient vs permanent; either way the user
    // gets a friendly retry hint rather than silence (owner sees the log for auth issues).
    if (err instanceof LlmProviderError) {
      logger.error({ kind: err.kind }, "voice transcription failed");
    } else {
      logger.error({ err }, "voice transcription failed");
    }
    return { kind: "unavailable", reply: STT_FAILED };
  }

  if (!text) return { kind: "unavailable", reply: STT_FAILED };

  const usage = await recordTranscriptionUsage(deps, userId, model, durationSeconds);
  return { kind: "ok", text, model, alertPct: usage.alertPct };
}

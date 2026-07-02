import { z } from "zod";

/**
 * The digest lane of `settings.proactivity` (docs/data-model.md reserves that jsonb
 * for per-lane proactivity toggles; JSON payloads are Zod-validated in app code, not
 * the DB). Bounded proactivity is a core identity trait — the OFF switches are part of
 * the feature: `enabled=false` turns the digest off until further notice,
 * `paused_until` mutes it temporarily ("pause the digest for a week"), and
 * `run_requested_at` is the chat-set "run it now" flag the next scheduler tick picks
 * up (and always wins over pause/disable — an explicit ask beats a standing mute).
 */

const digestLaneSchema = z.object({
  enabled: z.boolean().default(true),
  paused_until: z.string().datetime({ offset: true }).nullable().default(null),
  run_requested_at: z.string().datetime({ offset: true }).nullable().default(null),
});

export interface DigestLane {
  enabled: boolean;
  pausedUntil: Date | null;
  runRequestedAt: Date | null;
}

/** Parse the digest lane out of a raw proactivity object; malformed input → defaults. */
export function parseDigestLane(proactivity: Record<string, unknown>): DigestLane {
  const parsed = digestLaneSchema.safeParse(proactivity.digest ?? {});
  const lane = parsed.success
    ? parsed.data
    : { enabled: true, paused_until: null, run_requested_at: null };
  return {
    enabled: lane.enabled,
    pausedUntil: lane.paused_until ? new Date(lane.paused_until) : null,
    runRequestedAt: lane.run_requested_at ? new Date(lane.run_requested_at) : null,
  };
}

/**
 * Merge a lane change back into the raw proactivity object (other lanes untouched).
 * Returns a new object ready for SettingsRepository.update.
 */
export function withDigestLane(
  proactivity: Record<string, unknown>,
  patch: Partial<DigestLane>,
): Record<string, unknown> {
  const current = parseDigestLane(proactivity);
  const next = { ...current, ...patch };
  return {
    ...proactivity,
    digest: {
      enabled: next.enabled,
      paused_until: next.pausedUntil ? next.pausedUntil.toISOString() : null,
      run_requested_at: next.runRequestedAt ? next.runRequestedAt.toISOString() : null,
    },
  };
}

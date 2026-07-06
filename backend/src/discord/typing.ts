/** Discord expires the typing indicator after ~10s; refresh a bit earlier. */
export const TYPING_REFRESH_MS = 8_000;

/** Minimal channel surface for showing Discord's typing indicator. */
export interface TypingChannel {
  sendTyping(): Promise<void>;
}

/**
 * Show Discord's "is typing" indicator for the duration of `work`, refreshing
 * before Discord's ~10s expiry so long LLM turns stay covered.
 */
export async function withTyping<T>(
  channel: TypingChannel | null | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (!channel) return work();

  const tick = () => void channel.sendTyping().catch(() => {});
  tick();
  const interval = setInterval(tick, TYPING_REFRESH_MS);
  try {
    return await work();
  } finally {
    clearInterval(interval);
  }
}

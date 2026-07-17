/**
 * A keyed in-process promise queue that serializes agent turns per conversation.
 * Nothing else prevents two quick messages from running `runAgent` concurrently on
 * the same conversation — which interleaves history writes (the second turn's
 * context misses the first turn's reply), races the budget pre-check and
 * degradation-state updates, and can land replies out of order. Chaining each turn
 * onto the previous one for the same key fixes all three at the gateway layer while
 * leaving the agent core untouched; turns for different keys still run concurrently.
 *
 * Shared by the live message path (discord/client.ts) and the offline catch-up
 * (discord/catchup.ts) so live and catch-up turns can't interleave either.
 */
export class TurnQueue {
  /** Tail of each key's chain. Stored tails never reject (failures are swallowed
   * into the chain after being propagated to the caller), so one failed turn can't
   * poison the turns queued behind it. */
  private tails = new Map<string, Promise<void>>();

  /** Number of keys with a turn running or queued (for tests/introspection). */
  get size(): number {
    return this.tails.size;
  }

  /**
   * Run `task` once every previously queued task for `key` has settled. Returns
   * `task`'s own promise, so results and rejections reach the caller unchanged.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const tail = this.tails.get(key) ?? Promise.resolve();
    const result = tail.then(task);
    const next = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, next);
    // Drop the entry once the chain drains, unless another task was queued behind it,
    // so an idle process doesn't hold a map entry per conversation ever seen.
    void next.then(() => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    });
    return result;
  }
}

/**
 * The queue key for a Discord message: author + channel, which is exactly how
 * `handleIncomingMessage` resolves the conversation (one per user per channel), so
 * serializing on it serializes the conversation without coupling the gateway to the
 * conversation table.
 */
export function turnKey(authorDiscordId: string, channelId: string): string {
  return `${authorDiscordId}:${channelId}`;
}

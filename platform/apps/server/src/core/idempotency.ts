export interface IdempotencyStore {
  /** Returns true if `id` was already seen (duplicate → skip); records new ids. */
  seen(id: string): boolean;
}

/**
 * In-memory, bounded dedupe of WhatsApp `wa_message_id`. Meta retries webhook
 * deliveries, so handlers must be idempotent. FIFO eviction keeps memory bounded.
 * M2 swaps this for a persistent store (SQLite) behind the same interface.
 */
export function createIdempotencyStore(maxSize = 5000): IdempotencyStore {
  const ids = new Set<string>();
  return {
    seen(id: string): boolean {
      if (ids.has(id)) return true;
      ids.add(id);
      if (ids.size > maxSize) {
        const oldest = ids.values().next().value;
        if (oldest !== undefined) ids.delete(oldest);
      }
      return false;
    },
  };
}

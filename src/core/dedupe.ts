/**
 * Remembers message ids for a while so webhook retries from Meta are processed once.
 *
 * Meta retries a webhook delivery when it does not get a fast 200, and the same
 * message id can arrive more than once. In-memory is enough for a single instance;
 * with several replicas, back this with Redis `SET key 1 NX EX ttl` instead.
 */
export class MessageDeduper {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 50_000,
  ) {}

  /** Returns true the first time an id is seen (within the TTL), false for duplicates. */
  isFirstSeen(id: string): boolean {
    const now = this.now();
    this.evictExpired(now);

    const expiresAt = this.seen.get(id);
    if (expiresAt !== undefined && expiresAt > now) return false;

    this.seen.set(id, now + this.ttlMs);
    if (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.seen.size;
  }

  private evictExpired(now: number): void {
    // Map keeps insertion order and every entry has the same TTL,
    // so expired entries are always at the front.
    for (const [id, expiresAt] of this.seen) {
      if (expiresAt > now) break;
      this.seen.delete(id);
    }
  }
}

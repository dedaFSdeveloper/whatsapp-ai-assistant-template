export type FlushHandler<T> = (key: string, items: T[]) => void | Promise<void>;

export interface DebouncerOptions {
  /** Quiet period after the last item before flushing. */
  waitMs: number;
  /** Upper bound so a user who keeps typing still gets an answer. */
  maxWaitMs: number;
  onError?: (error: unknown, key: string) => void;
}

interface Pending<T> {
  items: T[];
  timer: ReturnType<typeof setTimeout>;
  firstAt: number;
}

/**
 * Groups items per key (one WhatsApp user) and flushes them together once the
 * user stops sending for `waitMs`. People often write "hi" / "I need" / "a cleaning"
 * as three messages; answering once, with the full context, is cheaper and reads better.
 */
export class Debouncer<T> {
  private readonly pending = new Map<string, Pending<T>>();

  constructor(
    private readonly options: DebouncerOptions,
    private readonly onFlush: FlushHandler<T>,
    private readonly now: () => number = Date.now,
  ) {}

  push(key: string, item: T): void {
    const now = this.now();
    const current = this.pending.get(key);

    if (current) {
      clearTimeout(current.timer);
      current.items.push(item);
    }

    const items = current?.items ?? [item];
    const firstAt = current?.firstAt ?? now;
    const delay = Math.max(0, Math.min(this.options.waitMs, this.options.maxWaitMs - (now - firstAt)));
    const timer = setTimeout(() => void this.flush(key), delay);
    this.pending.set(key, { items, firstAt, timer });
  }

  /** Flushes one key immediately (used on shutdown and in tests). */
  async flush(key: string): Promise<void> {
    const entry = this.pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    try {
      await this.onFlush(key, entry.items);
    } catch (error) {
      this.options.onError?.(error, key);
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((key) => this.flush(key)));
  }

  get pendingKeys(): number {
    return this.pending.size;
  }
}

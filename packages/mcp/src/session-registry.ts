export interface SessionRegistryOptions<T> {
  /** Evict a session after this many ms with no activity (default 30 min). */
  ttlMs?: number;
  /** How often the background sweep runs (default 60s). 0 disables the timer. */
  sweepIntervalMs?: number;
  /** Injectable clock — pass a fake for deterministic tests. */
  now?: () => number;
  /** Called when a session is evicted/closed (e.g. to close its transport). */
  onEvict?: (id: string, value: T) => void;
}

/**
 * A session registry with TTL idle-eviction. SSE (and the opt-in stateful
 * Streamable-HTTP mode) keep one transport per session; without eviction the
 * map leaks when a client never disconnects cleanly — the exact gap cms flagged
 * (its map evicted only on close, no TTL). `get()` touches the session, so an
 * active session is never swept. The background timer is `unref`'d so it never
 * keeps the process alive.
 */
export class SessionRegistry<T> {
  private readonly sessions = new Map<string, { value: T; lastSeen: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly onEvict?: (id: string, value: T) => void;
  private timer?: ReturnType<typeof setInterval>;

  constructor(opts: SessionRegistryOptions<T> = {}) {
    this.ttlMs = opts.ttlMs ?? 30 * 60_000;
    this.now = opts.now ?? Date.now;
    this.onEvict = opts.onEvict;
    const interval = opts.sweepIntervalMs ?? 60_000;
    if (interval > 0) {
      this.timer = setInterval(() => this.sweep(), interval);
      this.timer.unref?.();
    }
  }

  /** Store (or replace) a session, stamping it active now. */
  set(id: string, value: T): void {
    this.sessions.set(id, { value, lastSeen: this.now() });
  }

  /** Fetch a session and mark it active (resets its idle clock). */
  get(id: string): T | undefined {
    const entry = this.sessions.get(id);
    if (!entry) return undefined;
    entry.lastSeen = this.now();
    return entry.value;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  get size(): number {
    return this.sessions.size;
  }

  /** Evict every session idle longer than `ttlMs`. Returns the evicted ids. */
  sweep(): string[] {
    const cutoff = this.now() - this.ttlMs;
    const evicted: string[] = [];
    for (const [id, entry] of this.sessions) {
      if (entry.lastSeen < cutoff) {
        this.sessions.delete(id);
        this.onEvict?.(id, entry.value);
        evicted.push(id);
      }
    }
    return evicted;
  }

  /** Stop the sweep timer, evict all sessions. Call on shutdown. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const [id, entry] of this.sessions) this.onEvict?.(id, entry.value);
    this.sessions.clear();
  }
}

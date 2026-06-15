/**
 * Sliding-window rate limiter over a pluggable store. In-memory by default
 * (single-machine repos: cardmem / upmetrics / vn / sanne / cms); supply a
 * shared store (Turso/Redis) for stateless multi-machine fleets (trail) so the
 * window doesn't leak per machine. Never hardcodes a backend.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window after this hit (>= 0). */
  remaining: number;
  /** Epoch ms when the oldest in-window hit ages out (when the window frees up). */
  resetAt: number;
}

export interface RateLimitStore {
  /**
   * Record a hit for `key` at `now` and return the count of hits within the
   * trailing `windowMs` (including this one) plus the oldest in-window timestamp.
   */
  hit(key: string, now: number, windowMs: number): Promise<{ count: number; oldest: number }>;
}

/** Default in-memory store: a trailing log per key, pruned best-effort. */
export class MemoryRateLimitStore implements RateLimitStore {
  private hits = new Map<string, number[]>();
  private windows = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(pruneEveryMs = 60_000) {
    this.timer = setInterval(() => this.prune(), pruneEveryMs);
    // Never hold the process open for a rate limiter.
    (this.timer as { unref?: () => void }).unref?.();
  }

  async hit(key: string, now: number, windowMs: number): Promise<{ count: number; oldest: number }> {
    const cutoff = now - windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    arr.push(now);
    this.hits.set(key, arr);
    this.windows.set(key, windowMs);
    return { count: arr.length, oldest: arr[0] };
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, arr] of this.hits) {
      const windowMs = this.windows.get(key) ?? 60_000;
      const kept = arr.filter((t) => t > now - windowMs);
      if (kept.length) {
        this.hits.set(key, kept);
      } else {
        this.hits.delete(key);
        this.windows.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.hits.clear();
    this.windows.clear();
  }
}

export class SlidingWindowRateLimiter {
  private store: RateLimitStore;
  private readonly ownsStore: boolean;
  private readonly windowMs: number;
  private readonly max: number;

  constructor(opts: { windowMs: number; max: number; store?: RateLimitStore }) {
    if (opts.windowMs <= 0) throw new Error("SlidingWindowRateLimiter: windowMs must be > 0");
    if (opts.max <= 0) throw new Error("SlidingWindowRateLimiter: max must be > 0");
    this.windowMs = opts.windowMs;
    this.max = opts.max;
    this.store = opts.store ?? new MemoryRateLimitStore();
    this.ownsStore = !opts.store;
  }

  /**
   * Record a hit for `key` and decide. The second argument is either a `now`
   * timestamp (back-compat) or `{ now?, max? }` — a per-check `max` override lets
   * ONE limiter serve keys with different caps (e.g. cardmem's per-key
   * rateLimitPerHour), so a consumer needn't keep one limiter instance per cap.
   */
  async check(
    key: string,
    opts: number | { now?: number; max?: number } = {},
  ): Promise<RateLimitResult> {
    const o = typeof opts === "number" ? { now: opts } : opts;
    const now = o.now ?? Date.now();
    const max = o.max ?? this.max;
    const { count, oldest } = await this.store.hit(key, now, this.windowMs);
    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetAt: (oldest ?? now) + this.windowMs,
    };
  }

  /** Tear down the default in-memory store's prune timer (no-op for an injected store). */
  destroy(): void {
    if (this.ownsStore && this.store instanceof MemoryRateLimitStore) this.store.destroy();
  }
}

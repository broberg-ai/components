// F076.7 — the same delivery event WILL arrive twice, and a late one WILL
// arrive out of order.
//
// This is not defensive programming against a hypothetical. GatewayAPI publishes
// it: a webhook that does not answer 2xx within 5 SECONDS is retried with
// exponential backoff for up to 24 HOURS. A slow query, a deploy, one GC pause —
// and the identical event is delivered again. Duplicates are the normal case.
//
// TWO PROBLEMS, and only the first is obvious.
//
// 1. THE SAME EVENT TWICE. Harmless for a status write, expensive for whatever a
//    consumer hangs off it: a "your code is on its way" push sent twice, a
//    fan-out fired twice, a per-message charge counted twice.
//
// 2. A STATUS ARRIVING OUT OF ORDER — the one that bites silently. Retries plus
//    backoff mean a delayed `enroute` can land AFTER the `delivered` it
//    preceded. Last-write-wins then downgrades a delivered message back to
//    pending, and it STAYS WRONG FOREVER, because no further event is coming.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: own a database. The consumer supplies
// a tiny key/value store — the same shape @broberg/apikey already proves with
// its pluggable RateLimitStore. What this file DOES own is the ordering rule,
// which is the part every consumer would otherwise get wrong the same way.

import type { DeliveryReport, DeliveryState } from './delivery';

/**
 * The seam. Two required methods, one optional one that upgrades the guarantee.
 *
 * A `Map`, a Redis client, a table with a primary key — anything that can answer
 * "have I seen this string" satisfies it.
 */
export interface SmsEventStore {
  /** The stored value for this key, or null if never written / expired. */
  get(key: string): Promise<string | null> | string | null;
  /** Store a value. `ttlMs` is a HINT — a store that cannot expire may ignore it. */
  set(key: string, value: string, ttlMs?: number): Promise<void> | void;
  /**
   * OPTIONAL, and the difference between a real guarantee and a good-enough one.
   *
   * Atomically write only if the key is absent; return true if this call is the
   * one that wrote it. Redis SETNX, a unique constraint, a conditional put.
   *
   * WITHOUT IT, get-then-set is not atomic, and two copies of the same event
   * arriving in the SAME INSTANT can both be judged fresh. That window is small
   * and real. `inbox.guarantee` says out loud which one you have, so nobody has
   * to read this comment to find out.
   */
  setIfAbsent?(key: string, value: string, ttlMs?: number): Promise<boolean> | boolean;
}

/**
 * How long a processed event is remembered. GatewayAPI retries for up to 24
 * hours, so anything shorter lets the tail of a retry storm through as "new".
 * 48h is 24 with room for a clock that is not ours.
 */
export const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * In-memory store. The default, and honest about being one: it dedupes within
 * THIS process. Restart it, or run a second instance behind a load balancer, and
 * the same event is processed again.
 *
 * Bounded on purpose — an unbounded Map fed by a webhook endpoint is a memory
 * leak with a public URL.
 */
export class MemorySmsEventStore implements SmsEventStore {
  private readonly map = new Map<string, { value: string; expires: number }>();
  private readonly max: number;

  constructor(opts: { max?: number } = {}) {
    this.max = opts.max ?? 50_000;
  }

  get(key: string): string | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (hit.expires <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return hit.value;
  }

  set(key: string, value: string, ttlMs = DEFAULT_TTL_MS): void {
    if (this.map.size >= this.max) this.evict();
    this.map.set(key, { value, expires: Date.now() + ttlMs });
  }

  setIfAbsent(key: string, value: string, ttlMs = DEFAULT_TTL_MS): boolean {
    if (this.get(key) !== null) return false;
    this.set(key, value, ttlMs);
    return true;
  }

  /** Drop what has expired; if that frees nothing, drop the oldest inserted. */
  private evict(): void {
    const now = Date.now();
    for (const [k, v] of this.map) if (v.expires <= now) this.map.delete(k);
    while (this.map.size >= this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * FINALITY, and it is the whole ordering rule.
 *
 * `unknown` sits with `pending` at 0 deliberately: it means the gateway sent a
 * status string we could not interpret. A status we could not read must NEVER
 * displace one we could — otherwise a single unrecognised value turns a message
 * we know was delivered into a message we know nothing about.
 */
const FINALITY: Record<DeliveryState, number> = {
  pending: 0,
  unknown: 0,
  delivered: 1,
  failed: 1,
  expired: 1,
};

/** Terminal states, exported so a consumer can ask the same question we do. */
export function isTerminal(state: DeliveryState): boolean {
  return FINALITY[state] === 1;
}

export type InboxGuarantee = 'process' | 'shared' | 'shared-atomic';

export interface DeliveryVerdict {
  report: DeliveryReport;
  /** Act on this one? Everything a consumer does should hang off this flag. */
  fresh: boolean;
  /** Why it was not fresh. Absent when `fresh` is true. */
  reason?: 'duplicate' | 'superseded';
  /** The state that STANDS for this message id after this event — not necessarily this event's own state. */
  state: DeliveryState;
}

export interface DeliveryInboxConfig {
  /** Your store. Omit for an in-memory one — see `guarantee`. */
  store?: SmsEventStore;
  /** How long an event id is remembered. Default 48h. */
  ttlMs?: number;
  /**
   * Override how an event's identity is computed.
   *
   * The default is a CONTENT key — provider, message id, state, the provider's
   * own raw status word, and the timestamp. A retry is byte-identical, so it
   * collapses; two genuinely different events for one message always differ in
   * state or time. If your gateway hands you its own event id, use it here.
   */
  eventKey?(report: DeliveryReport): string;
  /** Namespace, if one store is shared with something else. Default 'sms'. */
  prefix?: string;
}

export interface DeliveryInbox {
  /**
   * What this inbox actually guarantees. Read it at boot, the way you read
   * `sms.mode` — a dedupe you believe is fleet-wide and is really per-process is
   * exactly the kind of thing nobody discovers until it has already cost money.
   *
   *   'process'       in-memory. Dedupes within THIS process only.
   *   'shared'        your store, but it has no setIfAbsent — two events arriving
   *                   at the same instant can both be judged fresh.
   *   'shared-atomic' your store provides setIfAbsent. This is the real thing.
   */
  readonly guarantee: InboxGuarantee;
  /** Judge one or many reports. Never throws. */
  accept(reports: DeliveryReport | DeliveryReport[]): Promise<DeliveryVerdict[]>;
}

const defaultEventKey = (r: DeliveryReport): string =>
  [r.provider, r.id, r.state, r.raw, r.at ?? ''].join(' ');

const time = (at?: string): number => {
  if (!at) return NaN;
  const t = Date.parse(at);
  return Number.isNaN(t) ? NaN : t;
};

/**
 * Wrap a store so duplicate and out-of-order delivery events cannot be acted on
 * twice or backwards.
 *
 * ```ts
 * const inbox = createDeliveryInbox({ store: redisStore });
 * for (const v of await inbox.accept(parseGatewayApiWebhook(body))) {
 *   if (!v.fresh) continue;             // a retry, or older news than we have
 *   await db.setStatus(v.report.id, v.state);
 *   if (v.state === 'failed') await alertSomeone(v.report);
 * }
 * ```
 */
export function createDeliveryInbox(config: DeliveryInboxConfig = {}): DeliveryInbox {
  const {
    store = new MemorySmsEventStore(),
    ttlMs = DEFAULT_TTL_MS,
    eventKey = defaultEventKey,
    prefix = 'sms',
  } = config;

  const guarantee: InboxGuarantee = !config.store
    ? 'process'
    : typeof store.setIfAbsent === 'function'
      ? 'shared-atomic'
      : 'shared';

  /** Claim an event key. True means THIS call is the one that gets to act on it. */
  const claim = async (key: string): Promise<boolean> => {
    if (typeof store.setIfAbsent === 'function') {
      return (await store.setIfAbsent(key, '1', ttlMs)) === true;
    }
    if ((await store.get(key)) !== null) return false;
    await store.set(key, '1', ttlMs);
    return true;
  };

  return {
    guarantee,

    async accept(input): Promise<DeliveryVerdict[]> {
      const reports = Array.isArray(input) ? input : [input];
      const out: DeliveryVerdict[] = [];

      for (const report of reports) {
        const stateKey = `${prefix}:state:${report.provider}:${report.id}`;

        const readStanding = async (): Promise<{ state: DeliveryState; at?: string } | null> => {
          const raw = await store.get(stateKey);
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as { state?: unknown; at?: unknown };
            if (typeof parsed.state !== 'string' || !(parsed.state in FINALITY)) return null;
            return {
              state: parsed.state as DeliveryState,
              ...(typeof parsed.at === 'string' ? { at: parsed.at } : {}),
            };
          } catch {
            return null;
          }
        };

        // 1. Have we already acted on this exact event?
        if (!(await claim(`${prefix}:event:${eventKey(report)}`))) {
          const held = await readStanding();
          out.push({ report, fresh: false, reason: 'duplicate', state: held?.state ?? report.state });
          continue;
        }

        // 2. Would acting on it move the message BACKWARDS?
        const standing = await readStanding();
        if (standing) {
          const incoming = FINALITY[report.state];
          const held = FINALITY[standing.state];

          // The guard this card exists for: never let a non-terminal state — or a
          // status we could not interpret — replace one we already resolved.
          if (incoming < held) {
            out.push({ report, fresh: false, reason: 'superseded', state: standing.state });
            continue;
          }

          // Same tier: the gateway's own timestamps decide when we have them.
          // Demote only on a STRICTLY older one; without timestamps the newest
          // arrival is the best information we have.
          if (incoming === held) {
            const a = time(report.at);
            const b = time(standing.at);
            if (!Number.isNaN(a) && !Number.isNaN(b) && a < b) {
              out.push({ report, fresh: false, reason: 'superseded', state: standing.state });
              continue;
            }
          }
        }

        await store.set(
          stateKey,
          JSON.stringify({ state: report.state, ...(report.at ? { at: report.at } : {}) }),
          ttlMs,
        );
        out.push({ report, fresh: true, state: report.state });
      }

      return out;
    },
  };
}

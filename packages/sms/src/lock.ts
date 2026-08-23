// F076.9 — the send-side lock.
//
// Christian, 2026-08-23: «Har vi en "lås/spærre" for at en kunde ikke kommer til
// at sende den samme besked flere gange til den samme modtager?»
//
// The answer was no. A double-clicked button, a retried job, a resubmitted form —
// each one called send() again, the gateway took it, and it was billed. The
// recipient got the same SMS two or three times.
//
// This is the MIRROR of ./idempotency.ts. Same hazard, opposite end of the pipe:
// there we stop a delivery receipt being PROCESSED twice, here we stop a message
// being SENT twice. Same store interface, so a consumer wires one thing.

import { MemorySmsEventStore, type InboxGuarantee, type SmsEventStore } from './idempotency';

declare const console: { warn(...args: unknown[]): void };

/**
 * Why a send was deliberately not made. Six different things, six values —
 * they are not interchangeable, and collapsing any two sends the reader to fix
 * the wrong thing.
 *
 *   disabled / not-allowlisted / no-provider   the environment said no
 *   duplicate                                  the send-side lock said no (F076.9)
 *   no-consent / opted-out                     the consent gate said no (F077)
 *
 * `no-consent` usually means an import failed. `opted-out` is a person's
 * decision. Same outcome, entirely different thing to do about it.
 */
export type SmsSkipReason =
  | 'disabled'
  | 'not-allowlisted'
  | 'no-provider'
  | 'duplicate'
  | 'no-consent'
  | 'opted-out';

export interface DuplicateGuardConfig {
  /**
   * How long an identical message to the same recipient is locked out, in ms.
   * Default 60 seconds — DELIBERATELY SHORT, and the opposite of the delivery
   * inbox's 48 hours, because the two windows fail in opposite directions.
   *
   * Too short and a duplicate slips through: cost, one extra SMS. Too long and a
   * LEGITIMATE repeat is blocked: cost, a customer never gets a message they
   * needed. The second is worse, so the window stays near the length of the
   * thing it is actually catching — a double-click, a retried job.
   */
  window?: number;
  /** Your store. Omit for an in-memory one — see `sms.duplicateGuard`. */
  store?: SmsEventStore;
}

export type DuplicateGuardMode = InboxGuarantee | 'off';

/** What the store holds under a lock key. */
type LockValue = { s: 'flight' | 'sent'; id?: string } | { s: 'void' };

export interface DuplicateGuard {
  /**
   * What the lock actually guarantees — the same three values as the delivery
   * inbox, plus 'off'. Read it at boot: a lock you believe is fleet-wide and is
   * really per-process still lets the second instance send.
   */
  readonly mode: DuplicateGuardMode;
  /**
   * A key identifying this exact message to this exact recipient.
   *
   * SHA-256, so THE STORE NEVER HOLDS THE MESSAGE OR THE NUMBER. Both are
   * personal data — an SMS body routinely carries a one-time code or an
   * appointment time — and a key travels to Redis, into logs, into a dump.
   * Hashing is the difference between a lock and a leak.
   */
  fingerprint(parts: { from: string; to: string; text: string; idempotencyKey?: string }): Promise<string>;
  /** Claim the right to send. `{ ok: false }` means someone already did. */
  claim(key: string): Promise<{ ok: true } | { ok: false; id?: string }>;
  /** Record the outcome so a later attempt can see it. Never throws. */
  settle(key: string, outcome: 'sent' | 'void', id?: string): Promise<void>;
}

const OFF_GUARD: DuplicateGuard = {
  mode: 'off',
  async fingerprint() {
    return '';
  },
  async claim() {
    return { ok: true };
  },
  async settle() {
    /* nothing is recorded when the guard is off */
  },
};

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The send-side lock. `createSms()` builds one for you; it is exported so it can
 * be tested directly and so a consumer can reason about it — not because it
 * needs wiring by hand.
 */
export function createDuplicateGuard(config: DuplicateGuardConfig | false | undefined): DuplicateGuard {
  if (config === false) return OFF_GUARD;
  const { window = 60_000, store = new MemorySmsEventStore() } = config ?? {};

  const mode: DuplicateGuardMode = !config?.store
    ? 'process'
    : typeof store.setIfAbsent === 'function'
      ? 'shared-atomic'
      : 'shared';

  const read = async (key: string): Promise<LockValue | null> => {
    const raw = await store.get(key);
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as LockValue;
      return v && (v.s === 'flight' || v.s === 'sent' || v.s === 'void') ? v : null;
    } catch {
      return null;
    }
  };

  return {
    mode,

    async fingerprint({ from, to, text, idempotencyKey }) {
      // An explicit key REPLACES the derived one entirely — that is what makes it
      // work in both directions: two identical messages given different keys both
      // send, and two different messages given one key collapse to a single send.
      const material = idempotencyKey ? `key ${idempotencyKey}` : `msg ${from} ${to} ${text}`;
      return `sms:lock:${await sha256Hex(material)}`;
    },

    async claim(key) {
      if (typeof store.setIfAbsent === 'function') {
        if (await store.setIfAbsent(key, JSON.stringify({ s: 'flight' }), window)) return { ok: true };
      }
      const held = await read(key);

      // A VOIDED lock is a previous send the gateway REFUSED. Retrying that is
      // exactly what a caller should do, so the lock must not stand in the way.
      // Overwriting here is not atomic even on an atomic store — accepted
      // deliberately: the worst case is two sends after a failure, which is far
      // cheaper than blocking every retry of a genuinely failed message.
      if (!held || held.s === 'void') {
        await store.set(key, JSON.stringify({ s: 'flight' }), window);
        return { ok: true };
      }

      // 'flight' means a send is in progress RIGHT NOW — the double-click case.
      // 'sent' means one already went. Both are refusals to send again, and the
      // id comes back so the caller keeps the handle to the message that did go.
      return { ok: false, ...(held.s === 'sent' && held.id ? { id: held.id } : {}) };
    },

    async settle(key, outcome, id) {
      try {
        const value: LockValue = outcome === 'void' ? { s: 'void' } : { s: 'sent', ...(id ? { id } : {}) };
        await store.set(key, JSON.stringify(value), window);
      } catch (err) {
        // The message already went. Failing the caller's send because the
        // BOOKKEEPING failed would make them retry a message that was delivered —
        // the exact thing this guard exists to prevent.
        console.warn(
          `[@broberg/sms] could not record the duplicate lock: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

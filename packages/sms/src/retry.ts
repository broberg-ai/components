// F076.11 — retry, but only what is safe to retry.
//
// THE PREREQUISITE IS WHY THIS IS SAFE NOW AND WAS NOT BEFORE. F076.6 made a
// send that never got an answer distinguishable from one that was refused, and
// F076.9's lock holds on an unknown. Retry built before those would have
// double-sent and double-charged on every timeout, and delivered two different
// one-time codes of which only one worked.
//
// So the top rule is already decided and is not re-opened here:
//
//   RETRY A REFUSAL. NEVER RETRY AN UNKNOWN.
//
// But not every refusal is worth retrying either, and that is the part a naive
// implementation gets wrong. A 401, a 403, a bad recipient, an unapproved sender
// name — these fail identically on attempt five. Retrying them wastes the
// caller's time, and on a 429 makes things actively worse.
//
// THE DECISION IS ON A BRAND, NEVER ON THE MESSAGE TEXT — same discipline as
// SmsUnknownError, and for the same reason: `err.message.includes('429')` is a
// classifier that agrees with any message containing those three characters.

declare const console: { warn(...args: unknown[]): void };

/**
 * Thrown by an adapter when the gateway refused in a way that is worth trying
 * again — a 429, or a 5xx.
 *
 * A 5xx IS RETRIED, and the residual risk is stated rather than hidden: a
 * gateway that failed on its own side has almost certainly not queued anything,
 * and "almost certainly" is not "certainly". If your traffic is one-time codes
 * and a duplicate would be worse than a miss, turn retry off for that client.
 * A timeout is NOT in this class — that is `SmsUnknownError`, and it is never
 * retried.
 */
export class SmsRetryableError extends Error {
  /** The brand the core branches on. Never instanceof — two copies of this package break that. */
  readonly smsRetryable = true as const;
  /** From a `Retry-After` header, in milliseconds, when the gateway sent one. */
  readonly retryAfterMs: number | undefined;

  constructor(message: string, opts: { retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'SmsRetryableError';
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/** True when this error means "the gateway said no, and it may say yes later". */
export function isRetryableSendError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { smsRetryable?: unknown }).smsRetryable === true;
}

/** The gateway's own requested wait, in ms, if it sent one. */
export function retryAfterFrom(err: unknown): number | undefined {
  if (!isRetryableSendError(err)) return undefined;
  const ms = (err as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/**
 * Parse a `Retry-After` header. Seconds, or an HTTP date.
 *
 * Returns undefined for 0 and for anything unparseable, so the caller falls back
 * to the backoff rather than retrying instantly — @broberg/apikey F010.9 learned
 * the mirror of this on the serving side (a Retry-After of 0 on a 429 tells a
 * client to hammer you immediately).
 */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const raw = header.trim();
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw) * 1000;
    return ms > 0 ? ms : undefined;
  }
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;
  const ms = at - now;
  return ms > 0 ? ms : undefined;
}

export interface RetryConfig {
  /**
   * How many EXTRA attempts after the first. Default 2, so three tries in total.
   * 0 disables retry as surely as omitting the config.
   */
  attempts?: number;
  /**
   * The wait before each retry, in ms. Default [500, 2000].
   *
   * DELIBERATELY A LIST, NOT A FORMULA. "Exponential with jitter" cannot be read
   * off a config to answer the only question that matters — what is the worst
   * case inside my request handler — and a caller who cannot answer that will
   * either not enable retry or enable it and be surprised.
   */
  delaysMs?: number[];
  /** Cap on a gateway's own Retry-After, so a 10-minute one cannot park a request handler. Default 10s. */
  maxRetryAfterMs?: number;
}

/** What retry will actually do, so a caller can read it at boot. */
export interface RetryPolicy {
  attempts: number;
  delaysMs: number[];
  /**
   * The cap applied to a gateway's own Retry-After.
   *
   * It lives ON THE POLICY, not only in the config, because the config value was
   * accepted and then silently ignored: attemptSend fell back to its own default
   * and a caller's `maxRetryAfterMs: 1000` did nothing. A field that is read in
   * one place and dropped in another looks wired from either end.
   */
  maxRetryAfterMs: number;
  /**
   * The worst case this policy can add, in ms, EXCLUDING the requests themselves.
   *
   * Read it with the provider's `timeoutMs` in mind: three attempts against a
   * 15-second timeout is 45 seconds of requests plus this. That total is what
   * sits inside your request handler.
   */
  worstCaseMs: number;
}

export const DEFAULT_RETRY_DELAYS = [500, 2000];

export function resolveRetry(config: RetryConfig | true | undefined): RetryPolicy | null {
  if (!config) return null;
  const { attempts = 2, delaysMs = DEFAULT_RETRY_DELAYS, maxRetryAfterMs = 10_000 } = config === true ? {} : config;
  if (attempts <= 0) return null;
  const delays = Array.from({ length: attempts }, (_, i) => delaysMs[Math.min(i, delaysMs.length - 1)] ?? 0);
  return {
    attempts,
    delaysMs: delays,
    maxRetryAfterMs,
    // The gateway's own Retry-After can replace a delay, so the worst case uses
    // whichever is larger per attempt rather than pretending the cap never applies.
    worstCaseMs: delays.reduce((sum, d) => sum + Math.max(d, maxRetryAfterMs), 0),
  };
}

/** How long to wait before attempt `index+1`, honouring the gateway when it asked. */
export function waitFor(policy: RetryPolicy, index: number, err: unknown): number {
  const maxRetryAfterMs = policy.maxRetryAfterMs;
  const asked = retryAfterFrom(err);
  const backoff = policy.delaysMs[index] ?? policy.delaysMs[policy.delaysMs.length - 1] ?? 0;
  if (asked === undefined) return backoff;
  if (asked > maxRetryAfterMs) {
    console.warn(
      `[@broberg/sms] the gateway asked for a ${Math.round(asked / 1000)}s Retry-After; capping at ` +
        `${Math.round(maxRetryAfterMs / 1000)}s so a request handler is not parked. Consider a queue instead.`,
    );
    return maxRetryAfterMs;
  }
  return asked;
}

export const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build the error an adapter should throw for a non-2xx, branded retryable when
 * the status says trying again could work.
 *
 * 429 and 5xx only. A 4xx that is not 429 is a permanent no — a 401, a 403, a
 * 422 about a bad recipient — and retrying it wastes the caller's time without
 * ever changing the answer.
 */
export function gatewayRefusal(status: number, message: string, headers?: Headers): Error {
  if (status === 429 || status >= 500) {
    return new SmsRetryableError(message, {
      ...(parseRetryAfter(headers?.get('retry-after')) !== undefined
        ? { retryAfterMs: parseRetryAfter(headers?.get('retry-after')) }
        : {}),
    });
  }
  return new Error(message);
}

/**
 * Run a send, retrying only what is safe to retry.
 *
 * An SmsUnknownError is not branded retryable, so it falls straight through —
 * which is the whole safety property, expressed as an absence rather than as a
 * special case someone can later delete.
 */
export async function attemptSend<T>(run: () => Promise<T>, policy: RetryPolicy | null): Promise<T> {
  if (!policy) return run();
  for (let i = 0; ; i += 1) {
    try {
      return await run();
    } catch (err) {
      if (i >= policy.attempts || !isRetryableSendError(err)) throw err;
      await sleep(waitFor(policy, i, err));
    }
  }
}

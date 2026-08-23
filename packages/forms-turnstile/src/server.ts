/**
 * Headless server core for spam-protected public forms: honeypot detection,
 * an in-memory sliding-window-ish IP rate limiter, and Cloudflare Turnstile
 * token verification. No framework imports — Next/Hono/etc. adapters compose
 * on top (see ./preact, ./hono).
 *
 * The rate limiter here is IN-PROCESS ONLY: it protects a single-process
 * deployment (Fly single machine, one Bun worker) but each instance has its
 * own Map, so it does NOT protect multi-instance/serverless deployments. For
 * a shared, pluggable-store rate limiter (Turso/Redis-backed), reach for
 * @broberg/apikey's SlidingWindowRateLimiter instead and pass its result into
 * applySpamGauntlet's blocked check yourself.
 */

import { createHash } from "node:crypto";

/** Cloudflare's official ALWAYS-PASS test keys — safe to commit, safe default
 *  for local dev/CI so the form flow works end-to-end without real keys. */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

/** Same test keys, named for direct use as Zod `.default()` values, e.g.
 *  `TURNSTILE_SITE_KEY: z.string().min(1).default(envDefaults.TURNSTILE_SITE_KEY)`. */
export const envDefaults = {
  TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
  TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
} as const;

export const HONEYPOT_FIELD = "_hp_email";

/** Returns true if the honeypot field was filled (i.e. likely a bot). */
export function isHoneypotTriggered(body: Record<string, unknown>): boolean {
  const val = body[HONEYPOT_FIELD];
  return val !== undefined && val !== "" && val !== null;
}

// ── IP rate limiter (in-process; see module doc for the multi-instance caveat) ──

interface RateEntry {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const store = new Map<string, RateEntry>();
let lastSweep = Date.now();

function sweep(): void {
  const now = Date.now();
  if (now - lastSweep < 60_000) return; // sweep at most once per minute
  lastSweep = now;
  for (const [key, entry] of store) {
    if (now - entry.windowStart > WINDOW_MS) store.delete(key);
  }
}

/** Hash the IP to a short prefix so rate-limiting never stores raw IPs
 *  (GDPR-friendly). 8 hex chars = 32 bits of entropy, plenty for a
 *  per-form hourly counter. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 8);
}

/** True if the given IP hash has exceeded the rate limit for this form. */
export function isRateLimited(ipHash: string, formName: string, maxPerHour: number): boolean {
  sweep();
  const key = `${formName}:${ipHash}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    return false;
  }

  entry.count++;
  return entry.count > maxPerHour;
}

/** Test-only: reset rate limiter state. */
export function _resetRateLimiter(): void {
  store.clear();
}

// ── Cloudflare Turnstile ─────────────────────────────────────────

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * The three things that can actually happen when you ask Cloudflare about a
 * token. `rejected` and `unavailable` are NOT the same fact, and the difference
 * is the whole point of this type:
 *
 *   rejected    — Cloudflare answered, and the answer is no. Blame the token.
 *   unavailable — we never got an answer. Blame nothing; we simply do not know.
 *
 * F024.8, and the same defect F024.7 fixed on the browser side of this package.
 * Before this existed, `unavailable` reached callers on TWO different channels
 * depending on the SHAPE of Cloudflare's failure — a non-JSON body threw, a JSON
 * body without `success` returned false — so no caller could handle it
 * consistently. And the `false` branch is the dangerous one: it renders as
 * "you failed the bot check", which tells a real person she is not human and
 * gives her nothing that can help. Measured in production at fd-sundhed, whose
 * form is the public contact route for 16,830 municipal employees.
 */
export type TurnstileOutcome =
  | { ok: true }
  | { ok: false; reason: "rejected"; errorCodes: string[] }
  | { ok: false; reason: "unavailable"; detail: string };

export interface VerifyTurnstileOptions {
  /** Optional; Cloudflare recommends it but does not require it. */
  remoteip?: string;
  /**
   * Abort the siteverify call after this many ms. Default 10s.
   *
   * Without one, a hung Cloudflare connection holds the request until the
   * platform kills the invocation — worse on Fly/serverless than locally,
   * and the user just watches a spinner.
   */
  timeoutMs?: number;
}

/**
 * Verify a Turnstile token and say WHICH of the three things happened.
 *
 * NEVER THROWS. Every failure, including a network error or a timeout, comes
 * back as `{ ok: false, reason: "unavailable" }` with a human-readable detail —
 * so the caller chooses the policy instead of inheriting it from the shape of
 * someone else's outage.
 */
export async function verifyTurnstile(
  token: string,
  secret: string,
  options: VerifyTurnstileOptions = {},
): Promise<TurnstileOutcome> {
  const { remoteip, timeoutMs = 10_000 } = options;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.set("remoteip", remoteip);

  let res: Response;
  try {
    res = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      reason: "unavailable",
      detail: timedOut
        ? `Cloudflare did not answer within ${timeoutMs}ms.`
        : `Could not reach Cloudflare: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    return { ok: false, reason: "unavailable", detail: `Cloudflare answered ${res.status}.` };
  }

  let data: { success?: unknown; "error-codes"?: unknown };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // A 200 with an HTML error/challenge page lands here. It is NOT a rejection.
    return { ok: false, reason: "unavailable", detail: "Cloudflare answered with a body that is not JSON." };
  }

  if (data.success === true) return { ok: true };

  if (data.success === false) {
    const raw = data["error-codes"];
    const errorCodes = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string") : [];
    return { ok: false, reason: "rejected", errorCodes };
  }

  // Answered, parsed, and did not say either yes or no. Previously this returned
  // false and became "you failed the bot check" — the exact lie this type exists
  // to stop. Absence of a verdict is not a verdict.
  return { ok: false, reason: "unavailable", detail: "Cloudflare answered without a boolean `success` field." };
}

/**
 * Verify a Cloudflare Turnstile token via siteverify. Returns true if valid.
 * `remoteip` is optional (Cloudflare recommends it but doesn't require it).
 *
 * @deprecated LOSSY — prefer {@link verifyTurnstile}. This signature cannot tell
 * "the token was rejected" from "we could not ask", and it splits the second one
 * across a return value and a thrown exception depending on how Cloudflare
 * failed. Kept byte-for-byte so existing callers do not change behaviour on an
 * upgrade (replace, prove, THEN remove); its exact behaviour is pinned by test.
 */
export async function validateTurnstile(
  token: string,
  secret: string,
  remoteip?: string,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.set("remoteip", remoteip);
  const res = await fetch(SITEVERIFY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}

// ── Gauntlet ─────────────────────────────────────────────────────

/**
 * Why a submission was blocked.
 *
 * `turnstile` means Cloudflare said NO. `turnstile-unavailable` means we could
 * not ask — a separate member on purpose, so a caller never renders "you failed
 * the bot check" at a real person because of someone else's outage.
 */
export type SpamBlockReason = "honeypot" | "rate-limit" | "turnstile" | "turnstile-unavailable";

export interface SpamCheckResult {
  blocked: boolean;
  reason?: SpamBlockReason;
}

export interface SpamGauntletOptions {
  /** Present → honeypot check runs. */
  honeypot?: { body: Record<string, unknown> };
  /** Present → rate-limit check runs. */
  rateLimit?: { ipHash: string; formName: string; maxPerHour: number };
  /** Present → Turnstile verification runs. */
  turnstile?: {
    token: string;
    secret: string;
    remoteip?: string;
    /** Abort the siteverify call after this many ms. Default 10s. */
    timeoutMs?: number;
    /**
     * What to do when Cloudflare cannot be REACHED (as opposed to answering no).
     *
     * `"throw"` (default) — raise, so an unguarded route fails closed. This is
     *   what this package already did for the dominant outage shape, so an
     *   upgrade does not silently convert somebody's 500 into a 400 that
     *   accuses a human. Fail-closed by default is also the right posture for
     *   a spam gate.
     * `"block"` — return { blocked: true, reason: "turnstile-unavailable" } so
     *   the caller can answer honestly ("we cannot check right now") or decide
     *   to let it through. That policy belongs to the caller, which is the
     *   whole point of F024.8 — it must not be a side effect of what shape
     *   Cloudflare's failure happened to take.
     */
    onUnavailable?: "throw" | "block";
  };
}

/** Chains honeypot → rate-limit → Turnstile in fail-fast order. Each layer is
 *  opt-in (only runs when its options key is provided) so a caller can adopt
 *  just the layers it needs. */
export async function applySpamGauntlet(opts: SpamGauntletOptions): Promise<SpamCheckResult> {
  if (opts.honeypot && isHoneypotTriggered(opts.honeypot.body)) {
    return { blocked: true, reason: "honeypot" };
  }
  if (
    opts.rateLimit &&
    isRateLimited(opts.rateLimit.ipHash, opts.rateLimit.formName, opts.rateLimit.maxPerHour)
  ) {
    return { blocked: true, reason: "rate-limit" };
  }
  if (opts.turnstile) {
    const { token, secret, remoteip, timeoutMs, onUnavailable = "throw" } = opts.turnstile;
    const outcome = await verifyTurnstile(token, secret, { remoteip, timeoutMs });
    if (!outcome.ok) {
      if (outcome.reason === "unavailable") {
        if (onUnavailable === "throw") {
          throw new Error(
            `Turnstile could not be verified: ${outcome.detail} This is NOT a failed bot check — ` +
              `do not tell the user she failed one. Pass onUnavailable:'block' to handle it as a result instead.`,
          );
        }
        return { blocked: true, reason: "turnstile-unavailable" };
      }
      return { blocked: true, reason: "turnstile" };
    }
  }
  return { blocked: false };
}

// ── Runtime site-key delivery ────────────────────────────────────

/** Single-source response shape for a GET /config-style route that serves the
 *  Turnstile site key at runtime (so rotating the key is a secret change, never
 *  a rebuild). Keeps the JSON shape identical across every stack's route. */
export function getSitekeyResponse(siteKey: string): { turnstileSiteKey: string } {
  return { turnstileSiteKey: siteKey };
}

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

/** Verify a Cloudflare Turnstile token via siteverify. Returns true if valid.
 *  `remoteip` is optional (Cloudflare recommends it but doesn't require it). */
export async function validateTurnstile(
  token: string,
  secret: string,
  remoteip?: string,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.set("remoteip", remoteip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}

// ── Gauntlet ─────────────────────────────────────────────────────

export type SpamBlockReason = "honeypot" | "rate-limit" | "turnstile";

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
  turnstile?: { token: string; secret: string; remoteip?: string };
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
    const ok = await validateTurnstile(
      opts.turnstile.token,
      opts.turnstile.secret,
      opts.turnstile.remoteip,
    );
    if (!ok) return { blocked: true, reason: "turnstile" };
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

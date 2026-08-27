/**
 * @broberg/chat/public — the wall in front of an OPEN chat endpoint (F079.5).
 *
 * An authenticated admin chat does not need this. A public one does, and not as
 * a hardening pass later: a public chat is an open LLM-spend faucet on a surface
 * where strangers decide the volume.
 *
 * NOTHING HERE IS RE-ROLLED. The sliding window is @broberg/apikey's and the bot
 * wall is @broberg/forms-turnstile's; both are taken structurally (the same way
 * the model is injected into `createChat`) so no consumer inherits a version pin
 * from us. A caret on 0.x locks the MINOR, and every @broberg package is 0.x —
 * F061.2 measured what that costs. Both packages ARE installed here as
 * devDependencies, pinned `>=x <1`, purely so a test proves these shapes still
 * match theirs rather than asserting it in prose.
 */

/** Structurally @broberg/apikey's `RateLimitResult`. */
export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Epoch ms when the window frees up. */
  resetAt: number;
  limit: number;
}

/** Structurally @broberg/apikey's `SlidingWindowRateLimiter`. */
export interface RateLimiterLike {
  check(key: string, opts?: number | { now?: number; max?: number }): Promise<RateLimitDecision>;
}

/**
 * Structurally @broberg/forms-turnstile's `TurnstileOutcome`.
 *
 * THREE states, not two, and they arrived there the same way we did: a rejection
 * tells a real person she is not human, while an outage is not her fault at all.
 */
export type TurnstileVerdict =
  | { ok: true }
  | { ok: false; reason: "rejected"; errorCodes?: string[] }
  | { ok: false; reason: "unavailable"; detail?: string };

export type TurnstileVerifierLike = (token: string) => Promise<TurnstileVerdict>;

export interface PublicChatGuard {
  rateLimit: {
    limiter: RateLimiterLike;
    /**
     * The bucket for THIS visitor. Whatever identifies one stranger from
     * another — a hashed IP, a signed cookie. One visitor's exhausted
     * allowance must never come out of another's.
     */
    keyFor: (req: Request) => string;
  };
  turnstile: {
    verify: TurnstileVerifierLike;
    /** Where the token sits in the posted body. Defaults to `turnstileToken`. */
    tokenFrom?: (body: unknown, req: Request) => string | null | undefined;
  };
}

/**
 * A public deployment CANNOT be constructed without both halves.
 *
 * "Must exist before the first public deploy, not after the first bill" only
 * means something if it is enforceable. Same shape as `can` in the core, the
 * strategy in F079.9 and the ceiling in the guard: a setting that looks present
 * and behaves absent is the whole class of defect this epic exists to remove.
 */
export function assertPublicChatGuard(guard: PublicChatGuard | undefined): asserts guard is PublicChatGuard {
  if (!guard || typeof guard !== "object") {
    throw new TypeError(
      'createChatHandler: mode "public" requires a `guard` with both a rate limit and Turnstile. An open ' +
        "endpoint with neither is an LLM bill anyone on the internet can write.",
    );
  }
  if (typeof guard.rateLimit?.limiter?.check !== "function" || typeof guard.rateLimit?.keyFor !== "function") {
    throw new TypeError(
      "createChatHandler: `guard.rateLimit` needs { limiter, keyFor }. Use @broberg/apikey's " +
        "SlidingWindowRateLimiter — do not re-roll a window.",
    );
  }
  if (typeof guard.turnstile?.verify !== "function") {
    throw new TypeError(
      "createChatHandler: `guard.turnstile` needs { verify }. Use @broberg/forms-turnstile's verifyTurnstile " +
        "bound to your secret — do not hand-roll a siteverify call.",
    );
  }
}

export type PublicRefusal =
  | { status: 429; error: "rate_limited"; retryAfterSeconds: number }
  | { status: 403; error: "turnstile_rejected" }
  | { status: 503; error: "turnstile_unavailable" };

/**
 * Run the wall. `null` means let the request through.
 *
 * ORDER MATTERS: the rate limit runs first because it is local and free, so a
 * flood is refused without our paying Cloudflare a round-trip per bot.
 */
export async function checkPublicRequest(
  guard: PublicChatGuard,
  req: Request,
  body: unknown,
  now: number = Date.now(),
): Promise<PublicRefusal | null> {
  const decision = await guard.rateLimit.limiter.check(guard.rateLimit.keyFor(req), { now });
  if (!decision.allowed) {
    // Floor of 1. `Retry-After: 0` reads as "try again immediately", which is
    // the opposite of what a limiter that just refused you means.
    const retryAfterSeconds = Math.max(1, Math.ceil((decision.resetAt - now) / 1000));
    return { status: 429, error: "rate_limited", retryAfterSeconds };
  }

  const token = (guard.turnstile.tokenFrom ?? defaultTokenFrom)(body, req);
  const verdict = await guard.turnstile.verify(typeof token === "string" ? token : "");
  if (verdict.ok) return null;

  // FAILS CLOSED WHEN CLOUDFLARE IS DOWN, and says so with its own status.
  // Failing open would be exactly backwards: an outage is the cheapest possible
  // moment for a bot flood, and the thing on the other side of this wall costs
  // money per request. A distinct 503 lets the surface say "not right now"
  // instead of telling a real person she failed a human test.
  return verdict.reason === "unavailable"
    ? { status: 503, error: "turnstile_unavailable" }
    : { status: 403, error: "turnstile_rejected" };
}

function defaultTokenFrom(body: unknown): string | null {
  const t = (body as { turnstileToken?: unknown } | null)?.turnstileToken;
  return typeof t === "string" ? t : null;
}

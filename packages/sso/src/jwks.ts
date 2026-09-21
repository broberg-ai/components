/**
 * The signing-key cache.
 *
 * ── THE ONE BEHAVIOUR THIS FILE EXISTS FOR ────────────────────────────────
 *
 * It refetches on an UNKNOWN KEY ID, not on a timer (F084.4's constraint, and
 * it is the right one). An interval is a guess about when somebody else will
 * rotate their key; an unknown kid is the event itself. With an interval, the
 * window between "BID rotated" and "the interval elapsed" is a window where
 * every login in every app fails, and the length of that window is a number
 * nobody chose on purpose.
 *
 * ── AND THE PART AN OBVIOUS IMPLEMENTATION GETS WRONG ─────────────────────
 *
 * "Unknown kid ⇒ refetch" turns anyone who can send this app a token into
 * someone who can make it hammer BID: a stream of tokens with random kids is a
 * stream of fetches against the one service the whole fleet logs in through.
 * So a refetch is rate-limited by time. The cost of the floor is real and worth
 * stating: a rotation landing inside the cooldown makes logins fail for up to
 * that many milliseconds. Seconds of failure for one app beats a way to aim
 * traffic at BID from outside.
 *
 * ── TWO FAILURES, NOT ONE (components-F084.50) ───────────────────────────────────────
 *
 * Reported by helpdesk, measured in the published 0.1.0 dist: at process start
 * the key set is EMPTY, so the first verification fetches. If BID is down in
 * that second, NOTHING verifies for that app — not just new logins. A process
 * that has been running and has seen a kid survives the same outage untouched.
 *
 * The recovery was never the defect: `lastFetchAt` is set only on SUCCESS, so a
 * failed fetch does not block the next attempt and the cache self-heals the
 * moment BID answers again. The defect was that `getKey` threw the SAME error
 * for two states whose correct answers are opposites:
 *
 *   cannot reach the issuer    transient. Retry, or answer 503. The token may
 *                              well be perfectly good — we simply did not look.
 *   kid is not published       permanent. This token was not signed by us.
 *                              Reject it, 401, and do not retry.
 *
 * One error name for both is how a caller ends up rejecting a legitimate user
 * because a foreign service had a bad minute — or, worse, retrying a forgery.
 * Hence two subclasses. They BOTH extend JwksError, so a 0.1.0 consumer whose
 * catch tests `instanceof JwksError` keeps working across the upgrade.
 *
 * ── WHAT WE DELIBERATELY DID NOT DO ───────────────────────────────────────
 *
 * We do NOT persist the key set. A stored key set that survives a REVOCATION is
 * a worse failure than a login that is down for two minutes — helpdesk's own
 * point, and the reason `keys = body.keys` replaces rather than merges. Writing
 * the set to disk would reintroduce exactly what that line exists to prevent.
 */
// jose 6 dropped the `KeyLike` alias; importJWK now answers
// `CryptoKey | Uint8Array` directly. Taking the type FROM the function
// rather than naming it means a future rename cannot silently widen it.
import { importJWK, type JWK } from "jose";

type SigningKey = Awaited<ReturnType<typeof importJWK>>;

export interface JwksCacheOptions {
  /** Absolute URL of the key set, taken from BID's discovery document. */
  jwksUri: string;
  /**
   * The floor between two refetches. Below it, an unknown kid is rejected
   * without asking BID again.
   */
  minRefetchIntervalMs?: number;
  /**
   * Fetch the key set once at construction, so the cold window sits at BOOT
   * rather than in front of the first user who tries to log in.
   *
   * It is fire-and-forget ON PURPOSE: a failed warm-up must never stop the app
   * from starting. A package that refuses to boot because someone else's
   * service is down has made the outage worse, not better — the first getKey
   * will simply fetch, exactly as it does today.
   */
  warmUp?: boolean;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests, so the cooldown can be exercised without waiting. */
  now?: () => number;
}

export interface JwksCache {
  /** Resolve a key for this kid, refetching once if it is unknown. */
  getKey(kid: string, alg: string): Promise<SigningKey>;
  /** How many times the remote key set has actually been fetched. */
  readonly fetchCount: number;
}

export class JwksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwksError";
  }
}

/**
 * The issuer could not be consulted — unreachable, a non-2xx, or a body that is
 * not a key set. Also thrown when an unknown kid arrives inside the refetch
 * cooldown, because there too the honest statement is "we did not look".
 *
 * TRANSIENT. The right response is to retry, or to answer 503 — never to
 * conclude anything about the token, which may be perfectly valid.
 */
export class JwksUnavailableError extends JwksError {
  constructor(message: string) {
    super(message);
    this.name = "JwksUnavailableError";
  }
}

/**
 * The issuer WAS consulted and does not publish this key id.
 *
 * PERMANENT. The token was not signed by this issuer. Reject it; retrying only
 * asks the same question again and BID will keep giving the same answer.
 */
export class JwksUnknownKeyError extends JwksError {
  constructor(message: string) {
    super(message);
    this.name = "JwksUnknownKeyError";
  }
}

export function createJwksCache(options: JwksCacheOptions): JwksCache {
  const {
    jwksUri,
    minRefetchIntervalMs = 10_000,
    warmUp = false,
    fetchImpl = fetch,
    now = () => Date.now(),
  } = options;

  let keys: JWK[] = [];
  let lastFetchAt = -Infinity;
  let fetchCount = 0;
  /** Collapses concurrent refetches into one request. */
  let inFlight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let res: Response;
      try {
        res = await fetchImpl(jwksUri);
      } catch (cause) {
        // A thrown fetch is DNS, TLS, a refused connection — the issuer was not
        // reached at all. Rethrown as our own type so a caller never has to
        // pattern-match on a runtime's network error to tell this from a
        // rejected token.
        throw new JwksUnavailableError(
          `${jwksUri} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      if (!res.ok) {
        throw new JwksUnavailableError(
          `${jwksUri} answered ${res.status} — cannot verify any token right now`,
        );
      }
      const body = (await res.json()) as { keys?: JWK[] };
      if (!Array.isArray(body.keys)) {
        // Reachable but not serving a key set: still "we could not look".
        throw new JwksUnavailableError(`${jwksUri} returned no "keys" array`);
      }
      // Replace rather than merge. Merging would keep a REVOKED key usable
      // forever, which is the one thing rotating a key is meant to stop.
      keys = body.keys;
      lastFetchAt = now();
      fetchCount++;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  if (warmUp) {
    // Swallowed deliberately — see `warmUp` above. The failure is not lost:
    // the next getKey reports it to the caller who can actually act on it.
    void refresh().catch(() => {});
  }

  return {
    get fetchCount() {
      return fetchCount;
    },

    async getKey(kid: string, alg: string) {
      let jwk = keys.find((k) => k.kid === kid);

      if (!jwk) {
        const sinceLast = now() - lastFetchAt;
        if (sinceLast < minRefetchIntervalMs) {
          // The wording matters as much as the class, and this sentence is
          // helpdesk's, not mine. The old one said "Refusing to refetch — retry
          // shortly": transient ADVICE on a state that does not improve by
          // waiting, which literally instructs a consumer to do the thing the
          // split exists to prevent. It described what the CACHE did; a caller
          // needs to know what the STATE is.
          //
          // It carries the AGE because that is the number that decides. Their
          // measurement against the live issuer showed a key set 2ms old — we
          // had just looked, and the kid was not there. That is evidence of a
          // forgery, not of ignorance. Only a rotation inside the floor can
          // make this a false negative, and the age is what lets a caller see
          // which case it is standing in.
          throw new JwksUnavailableError(
            `kid ${kid} is not in the key set we hold, fetched ${sinceLast}ms ago ` +
              `(we do not ask the issuer again within ${minRefetchIntervalMs}ms). ` +
              `A key set this fresh that lacks the kid means the token was not signed by ` +
              `this issuer — reject it. Only a key rotation within the last ` +
              `${minRefetchIntervalMs}ms could make that wrong.`,
          );
        }
        await refresh();
        jwk = keys.find((k) => k.kid === kid);
      }

      if (!jwk) {
        throw new JwksUnknownKeyError(
          `Broberg ID does not publish a signing key with kid ${kid}. ` +
            `The token was not signed by this issuer.`,
        );
      }
      return importJWK(jwk, alg);
    },
  };
}

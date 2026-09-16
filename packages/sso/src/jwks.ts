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

export function createJwksCache(options: JwksCacheOptions): JwksCache {
  const {
    jwksUri,
    minRefetchIntervalMs = 10_000,
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
      const res = await fetchImpl(jwksUri);
      if (!res.ok) {
        throw new JwksError(`${jwksUri} answered ${res.status} — cannot verify any token`);
      }
      const body = (await res.json()) as { keys?: JWK[] };
      if (!Array.isArray(body.keys)) {
        throw new JwksError(`${jwksUri} returned no "keys" array`);
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

  return {
    get fetchCount() {
      return fetchCount;
    },

    async getKey(kid: string, alg: string) {
      let jwk = keys.find((k) => k.kid === kid);

      if (!jwk) {
        const sinceLast = now() - lastFetchAt;
        if (sinceLast < minRefetchIntervalMs) {
          throw new JwksError(
            `no signing key with kid ${kid}, and the key set was refreshed ${sinceLast}ms ago ` +
              `(floor is ${minRefetchIntervalMs}ms). Refusing to refetch — retry shortly.`,
          );
        }
        await refresh();
        jwk = keys.find((k) => k.kid === kid);
      }

      if (!jwk) {
        throw new JwksError(
          `Broberg ID does not publish a signing key with kid ${kid}. ` +
            `The token was not signed by this issuer.`,
        );
      }
      return importJWK(jwk, alg);
    },
  };
}

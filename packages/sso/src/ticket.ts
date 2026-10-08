/**
 * F084.153 — verify a Broberg ID ticket LOCALLY (broberg-id-F087.4).
 *
 * A ticket is how one service or agent proves who it is to another without a
 * shared secret: Broberg ID signs a short-lived JWT, the receiver checks it
 * against BID's PUBLIC keys. Nothing secret lives at the receiver.
 *
 * Format: broberg-id docs/features/F087.1-identitetsmodel.md §3 (draft, 8/10).
 *   iss = the issuer · aud = the receiver's URL · scope = space-separated
 *   sub = client_id = the caller · principal_type = human | service | agent
 *   org · act {sub} only on delegation (RFC 8693) · exp/iat/jti
 *
 * This is deliberately NOT a method on createSsoClient: a service that only
 * RECEIVES tickets is not a login client — it has no client_id, no redirect,
 * no session. It needs the issuer, its own audience, and the key set.
 *
 * TWO FAILURES, TWO ANSWERS — keep them apart in the caller:
 *   JwksUnavailableError → we could not ask BID right now. Answer 503 and let
 *                           the caller retry; the ticket may be perfectly valid.
 *   SsoError             → the ticket is not acceptable. Answer 401/403.
 * A known key is served from cache, so a ticket signed with it verifies while
 * BID is briefly unreachable.
 */
import { decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { ALLOWED_ALGS, SsoError } from "./client.js";
import { createJwksCache, JwksUnavailableError, type JwksCache } from "./jwks.js";

export type PrincipalType = "human" | "service" | "agent";
const PRINCIPAL_TYPES: readonly PrincipalType[] = ["human", "service", "agent"];

/** What a verified ticket tells the receiver — a small, typed principal, never the raw payload. */
export interface TicketPrincipal {
  /** Who is calling: the ticket's `sub` (a client id such as `svc-trail`). */
  principal: string;
  type: PrincipalType;
  /** The client the ticket was issued to (`client_id`, falling back to `sub`). */
  clientId: string;
  /** The organisation, when BID stated one. */
  org: string | null;
  /** On delegation: who the caller is acting for (RFC 8693 `act.sub`). */
  act: { sub: string } | null;
  scopes: string[];
  /** Seconds since the epoch. */
  exp: number;
  jti: string;
}

export interface TicketVerifierOptions {
  /** BID's issuer, exactly as it signs `iss` — e.g. `https://id.broberg.ai`. */
  issuer: string;
  /** THIS receiver's audience — its own URL, e.g. `https://discovery.broberg.ai`. */
  audience: string;
  /** The key set URL. Omitted: read once from the issuer's discovery document. */
  jwksUri?: string;
  /**
   * The longest lifetime (exp − iat) a ticket may claim. BID issues 5 min
   * (service) and 15 min (agent); anything longer was not minted by the policy
   * we were told about, so it is refused rather than trusted for longer.
   */
  maxLifetimeSec?: number;
  /** Seconds of clock skew to allow on exp/iat. Default 30. */
  clockToleranceSec?: number;
  /** Fetch the key set at construction, so the first caller does not wait. */
  warmUp?: boolean;
  fetchImpl?: typeof fetch;
  minRefetchIntervalMs?: number;
}

export interface TicketVerifier {
  /** Verify a ticket; with `scope`, also require that scope to be granted. */
  verify(token: string, options?: { scope?: string | string[] }): Promise<TicketPrincipal>;
}

export function createTicketVerifier(options: TicketVerifierOptions): TicketVerifier {
  const {
    issuer,
    audience,
    maxLifetimeSec = 15 * 60,
    clockToleranceSec = 30,
    fetchImpl = fetch,
  } = options;
  if (!issuer) throw new SsoError("createTicketVerifier needs an issuer");
  if (!audience) throw new SsoError("createTicketVerifier needs this receiver's audience");

  let cachePromise: Promise<JwksCache> | null = null;
  const cacheFor = (jwksUri: string) =>
    createJwksCache({
      jwksUri,
      fetchImpl,
      ...(options.warmUp ? { warmUp: true } : {}),
      ...(options.minRefetchIntervalMs !== undefined ? { minRefetchIntervalMs: options.minRefetchIntervalMs } : {}),
    });

  async function keys(): Promise<JwksCache> {
    cachePromise ??= (async () => {
      if (options.jwksUri) return cacheFor(options.jwksUri);
      const url = `${issuer}/.well-known/openid-configuration`;
      let doc: { issuer?: string; jwks_uri?: string };
      try {
        const res = await fetchImpl(url);
        if (!res.ok) throw new Error(`answered ${res.status}`);
        doc = (await res.json()) as typeof doc;
      } catch (cause) {
        // Reached nothing usable: transient, the same class a key-set outage gets.
        throw new JwksUnavailableError(`${url}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      if (doc.issuer !== issuer) {
        throw new SsoError(`issuer is ${issuer} but ${url} says ${doc.issuer} — they must match exactly`);
      }
      if (!doc.jwks_uri) throw new SsoError(`${url} names no jwks_uri`);
      return cacheFor(doc.jwks_uri);
    })().catch((err) => {
      cachePromise = null; // a later call retries instead of caching the failure
      throw err;
    });
    return cachePromise;
  }
  if (options.warmUp) void keys().catch(() => {});

  return {
    async verify(token, opts = {}) {
      let header;
      try {
        header = decodeProtectedHeader(token);
      } catch {
        throw new SsoError("ticket is not a JWS");
      }
      if (!header.kid) throw new SsoError("ticket has no kid — cannot pick a signing key");
      if (header.typ === "logout+jwt") throw new SsoError("a logout token is not a ticket");

      const cache = await keys();
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, async () => cache.getKey(header.kid!, header.alg ?? "EdDSA"), {
          issuer,
          audience,
          algorithms: ALLOWED_ALGS,
          clockTolerance: clockToleranceSec,
          requiredClaims: ["exp", "iat", "jti", "sub"],
        }));
      } catch (e) {
        // A key-set outage must surface as itself (→ 503), never as "rejected".
        if (e instanceof JwksUnavailableError) throw e;
        throw new SsoError(`ticket rejected: ${e instanceof Error ? e.message : String(e)}`);
      }

      // An ID token or a logout token must never pass as a ticket. They carry
      // no principal_type; a logout token carries events, an ID token a nonce.
      if ("events" in payload) throw new SsoError("a logout token is not a ticket");
      if ("nonce" in payload) throw new SsoError("an ID token is not a ticket");

      const type = payload.principal_type;
      if (typeof type !== "string" || !PRINCIPAL_TYPES.includes(type as PrincipalType)) {
        throw new SsoError(`ticket has no valid principal_type (got ${JSON.stringify(type)})`);
      }
      const lifetime = payload.exp! - payload.iat!;
      if (lifetime > maxLifetimeSec) {
        throw new SsoError(`ticket claims a ${lifetime}s lifetime; at most ${maxLifetimeSec}s is accepted`);
      }
      if (typeof payload.sub !== "string" || payload.sub === "") throw new SsoError("ticket has no sub");

      const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
      const required = opts.scope === undefined ? [] : Array.isArray(opts.scope) ? opts.scope : [opts.scope];
      const missing = required.filter((s) => !scopes.includes(s));
      if (missing.length) throw new SsoError(`ticket lacks scope ${missing.join(", ")}`);

      const actRaw = payload.act as { sub?: unknown } | undefined;
      const act = actRaw && typeof actRaw.sub === "string" && actRaw.sub ? { sub: actRaw.sub } : null;
      return {
        principal: payload.sub,
        type: type as PrincipalType,
        clientId: typeof payload.client_id === "string" && payload.client_id ? payload.client_id : payload.sub,
        org: typeof payload.org === "string" && payload.org ? payload.org : null,
        act,
        scopes,
        exp: payload.exp!,
        jti: String(payload.jti),
      };
    },
  };
}

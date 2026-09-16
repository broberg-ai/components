/**
 * The core: framework-free, public-client OAuth 2.1 against Broberg ID.
 *
 * ── THIS PACKAGE IS A PUBLIC CLIENT. THERE IS NO CLIENT SECRET. ───────────
 *
 * Deliberate, and F084.4 AC#4 greps the published tarball to keep it that way.
 * PKCE alone carries the exchange. That is safe here for a reason worth stating
 * rather than assuming: BID matches redirect addresses EXACTLY (measured — one
 * trailing slash is refused), so the authorization code is delivered to this
 * app's own server and nowhere else. An attacker who knows the client id can
 * start a flow; they cannot receive its result.
 *
 * What it buys is the thing the card actually asks for: a secret that does not
 * exist cannot be committed, leaked in a log, copied into a second app, or left
 * behind in a repository someone later makes public.
 *
 * ── AND WHAT THIS PACKAGE MUST NEVER LEARN TO DO ──────────────────────────
 *
 * No passwords. No passkey registration. No social-provider keys. No email
 * verification. All of it lives in BID. A client that CAN do any of it is a
 * client somebody eventually uses to do it — and then the identity rules exist
 * in two places and drift.
 */
import { decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import type { SsoConfig } from "./config.js";
import { createJwksCache, type JwksCache } from "./jwks.js";

/* ── discovery ───────────────────────────────────────────────────────────── */

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
}

export class SsoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsoError";
  }
}

/* ── PKCE ────────────────────────────────────────────────────────────────── */

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

async function challengeFor(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

/* ── the shapes a caller handles ─────────────────────────────────────────── */

/**
 * What `beginLogin` produces. Every field except `url` must survive the round
 * trip to BID and back — the adapter stores them in a short-lived cookie.
 *
 * They are NOT optional extras. `state` is what makes the callback provably the
 * answer to THIS request, and `nonce` is what stops a valid token minted for
 * some other login from being replayed into this one.
 */
export interface LoginStart {
  url: string;
  state: string;
  codeVerifier: string;
  nonce: string;
}

export interface SsoClaims extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
}

export interface LoginResult {
  claims: SsoClaims;
  idToken: string;
  accessToken?: string;
  refreshToken?: string;
}

/**
 * `prompt=none` asks BID to answer WITHOUT showing anything (F084.6).
 *
 * The delivery method decides whether it works, and this package only ever
 * produces a URL for a FULL TOP-LEVEL REDIRECT. It never returns anything an
 * app could put in a hidden iframe, because an iframe against the identity
 * provider is third-party context: Safari has blocked it for years and Chrome
 * is retiring it. That path works in testing on a Mac and fails for every user
 * on an iPhone — a failure that looks like "you are not logged in".
 */
export interface BeginLoginOptions {
  prompt?: "none" | "login" | "consent" | "select_account";
  /** Extra scopes for this one request, on top of the configured set. */
  scopes?: string[];
}

export interface SsoClient {
  discovery(): Promise<Discovery>;
  beginLogin(options?: BeginLoginOptions): Promise<LoginStart>;
  completeLogin(input: {
    params: URLSearchParams;
    state: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<LoginResult>;
  verifyIdToken(idToken: string, options?: { nonce?: string }): Promise<SsoClaims>;
  logoutUrl(options?: { idTokenHint?: string; postLogoutRedirectUri?: string }): Promise<string>;
  /** Exposed for tests and for a health check; not needed in normal use. */
  readonly jwks: JwksCache;
}

export interface CreateSsoClientOptions {
  fetchImpl?: typeof fetch;
  /** Passed through to the key cache; see jwks.ts for why there is a floor. */
  minRefetchIntervalMs?: number;
}

export function createSsoClient(
  config: SsoConfig,
  options: CreateSsoClientOptions = {},
): SsoClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  let discoveryPromise: Promise<Discovery> | null = null;
  let jwksCache: JwksCache | null = null;

  async function discovery(): Promise<Discovery> {
    discoveryPromise ??= (async () => {
      const url = `${config.issuer}/.well-known/openid-configuration`;
      const res = await fetchImpl(url);
      if (!res.ok) throw new SsoError(`${url} answered ${res.status}`);
      const doc = (await res.json()) as Discovery;

      // STRICT equality, and it is not pedantry. Better Auth's default basePath
      // advertised `<origin>/api/auth` as the issuer — measured on a running
      // BID during F084.1. If the document's issuer and our configured issuer
      // disagree, every token this app later verifies will be rejected for a
      // reason that reads as a signature problem. Refuse at boot instead.
      if (doc.issuer !== config.issuer) {
        throw new SsoError(
          `BID_ISSUER is ${config.issuer} but ${url} says its issuer is ${doc.issuer}. ` +
            `These must match exactly — tokens are validated against the issuer string.`,
        );
      }
      return doc;
    })().catch((err) => {
      discoveryPromise = null; // let a later call retry rather than cache a failure
      throw err;
    });
    return discoveryPromise;
  }

  async function keys(): Promise<JwksCache> {
    if (!jwksCache) {
      const { jwks_uri } = await discovery();
      jwksCache = createJwksCache({
        jwksUri: jwks_uri,
        fetchImpl,
        ...(options.minRefetchIntervalMs !== undefined
          ? { minRefetchIntervalMs: options.minRefetchIntervalMs }
          : {}),
      });
    }
    return jwksCache;
  }

  async function verifyIdToken(idToken: string, opts: { nonce?: string } = {}) {
    const cache = await keys();
    const header = decodeProtectedHeader(idToken);
    if (!header.kid) throw new SsoError("ID token has no kid — cannot pick a signing key");

    const { payload } = await jwtVerify(
      idToken,
      async () => cache.getKey(header.kid!, header.alg ?? "RS256"),
      { issuer: config.issuer, audience: config.clientId },
    );

    if (opts.nonce !== undefined && payload.nonce !== opts.nonce) {
      throw new SsoError(
        "ID token nonce does not match this login request — refusing a token minted for another sign-in.",
      );
    }
    if (typeof payload.sub !== "string" || payload.sub === "") {
      throw new SsoError("ID token has no sub — there is no user to be");
    }
    return payload as SsoClaims;
  }

  /**
   * Fetch the profile claims and fold them in.
   *
   * NOT an optimisation — it is the only way to learn a user's name. MEASURED
   * against the live Broberg ID on 16 Sep 2026:
   *
   *   ID token   iss · sub · aud · iat · exp · auth_time · acr · at_hash
   *   userinfo   sub · name · given_name · family_name · email · email_verified
   *
   * That is correct OIDC for an authorization-code flow: profile claims belong
   * to the userinfo endpoint, and an ID token proving WHO you are does not have
   * to say what you are called. An app that only reads the ID token gets a
   * signed identity and a blank name — which is exactly what the first run of
   * the example app showed on screen.
   *
   * ── THE CHECK A NAIVE VERSION SKIPS ───────────────────────────────────────
   *
   * The `sub` from userinfo MUST equal the `sub` in the ID token (OIDC Core
   * 5.3.2 says MUST). Without it, a userinfo response for a DIFFERENT user
   * would be merged over a correctly verified identity — the app would show,
   * and act as, somebody else, with a valid signature underneath. A mismatch is
   * refused outright rather than reconciled.
   */
  async function withUserInfo(claims: SsoClaims, accessToken: string): Promise<SsoClaims> {
    const doc = await discovery();
    if (!doc.userinfo_endpoint) return claims;

    const res = await fetchImpl(doc.userinfo_endpoint, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    // A failure here must NOT lose the sign-in: the identity is already proven
    // by the ID token. The user ends up with a session and no display name,
    // which is worse than having one and far better than being logged out.
    if (!res.ok) return claims;

    const info = (await res.json()) as Record<string, unknown>;
    if (info.sub !== claims.sub) {
      throw new SsoError(
        `userinfo describes ${String(info.sub)} but the ID token is for ${claims.sub} — ` +
          `refusing to merge another user's profile onto this session.`,
      );
    }
    return { ...claims, ...info, sub: claims.sub };
  }

  return {
    discovery,
    get jwks() {
      if (!jwksCache) throw new SsoError("the key cache is created on first verification");
      return jwksCache;
    },
    verifyIdToken,

    async beginLogin(opts: BeginLoginOptions = {}): Promise<LoginStart> {
      const { authorization_endpoint } = await discovery();
      const codeVerifier = randomToken();
      const state = randomToken(16);
      const nonce = randomToken(16);

      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: [...new Set([...config.scopes, ...(opts.scopes ?? [])])].join(" "),
        state,
        nonce,
        code_challenge: await challengeFor(codeVerifier),
        code_challenge_method: "S256",
      });
      if (opts.prompt) params.set("prompt", opts.prompt);

      return { url: `${authorization_endpoint}?${params}`, state, codeVerifier, nonce };
    },

    async completeLogin({ params, state, codeVerifier, nonce }) {
      // An ERROR comes back on the same redirect as a success — BID answers a
      // refused `prompt=none` by redirecting here with ?error=login_required.
      // Reading only for `code` would make a refusal look like a malformed
      // response instead of the expected answer it is.
      const error = params.get("error");
      if (error) {
        throw new SsoError(
          `Broberg ID refused this login: ${error}` +
            (params.get("error_description") ? ` — ${params.get("error_description")}` : ""),
        );
      }

      const returned = params.get("state");
      if (!returned || returned !== state) {
        throw new SsoError(
          "state does not match the login this browser started — refusing the callback.",
        );
      }

      const code = params.get("code");
      if (!code) throw new SsoError("callback carried neither an error nor a code");

      const { token_endpoint } = await discovery();
      const res = await fetchImpl(token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
          client_id: config.clientId,
          code_verifier: codeVerifier,
        }),
      });

      const body = (await res.json()) as {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
        error?: string;
        error_description?: string;
      };
      if (!res.ok || !body.id_token) {
        throw new SsoError(
          `token exchange failed (${res.status}): ${body.error ?? "no id_token in response"}` +
            (body.error_description ? ` — ${body.error_description}` : ""),
        );
      }

      const claims = await verifyIdToken(body.id_token, { nonce });

      return {
        claims: body.access_token ? await withUserInfo(claims, body.access_token) : claims,
        idToken: body.id_token,
        ...(body.access_token ? { accessToken: body.access_token } : {}),
        ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
      };
    },

    async logoutUrl(opts = {}) {
      const doc = await discovery();
      if (!doc.end_session_endpoint) {
        throw new SsoError(
          `${config.issuer} does not advertise end_session_endpoint — central logout is unavailable.`,
        );
      }
      const params = new URLSearchParams();
      if (opts.idTokenHint) params.set("id_token_hint", opts.idTokenHint);
      const post = opts.postLogoutRedirectUri ?? config.postLogoutRedirectUri;
      if (post) params.set("post_logout_redirect_uri", post);
      params.set("client_id", config.clientId);
      return `${doc.end_session_endpoint}?${params}`;
    },
  };
}

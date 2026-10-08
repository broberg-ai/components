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
  /** What the issuer says it signs with. Absent on some providers. */
  id_token_signing_alg_values_supported?: string[];
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

/**
 * F095.2 — the user must log in again: there is no live session, no stored
 * tokens, or the renewal was refused. `reason` says which; "no_session" means
 * there never was a login to recover, the others mean there was one and it is
 * spent. Thrown by getAccessToken.
 */
export class SsoReauthError extends SsoError {
  constructor(
    message: string,
    readonly reason: "no_session" | "no_tokens" | "expired" | "refresh_failed",
  ) {
    super(message);
    this.name = "SsoReauthError";
  }
}

/**
 * F095.2 — BID's app API answered with an error, or did not answer at all.
 * `status` is BID's HTTP status (null when nothing came back: timeout, network);
 * `code` is BID's own `error` field when it sent one. The message carries the
 * URL, the status and the code — never the body, never a token.
 */
export class SsoAppApiError extends SsoError {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "SsoAppApiError";
  }
}

/**
 * F095.2 — BID refused because the user's token lacks a scope (403
 * insufficient_scope). For the profile writes that is `profile:write`: the app
 * must request it at login, and a user who logged in before it did must log in
 * again. That is the one actionable fact, so it gets its own class.
 */
export class SsoInsufficientScopeError extends SsoAppApiError {
  constructor(message: string, readonly scope: string) {
    super(message, 403, "insufficient_scope");
    this.name = "SsoInsufficientScopeError";
  }
}

/** F095.2 — an avatar refused BEFORE it was sent: too big, or not PNG/JPEG/WebP. */
export class SsoAvatarRejectedError extends SsoError {
  constructor(message: string, readonly reason: "too_large" | "unsupported_type") {
    super(message);
    this.name = "SsoAvatarRejectedError";
  }
}

/** BID's limit for a profile picture (llms.txt step 7a: "max 2 MB", read as 2 MiB). */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
/** The picture types BID accepts. */
export const AVATAR_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];

/** "image/PNG; charset=x" → "image/png". */
export function mediaType(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

/** The signed-in user's own profile, as BID's GET /api/app/profile returns it. */
export interface BidProfile {
  sub: string;
  name: string | null;
  picture: string | null;
  email: string | null;
  /** BID's own account page — mail, password, passkeys, 2FA and sessions live there. */
  account_url: string;
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
  /**
   * The claims in `claims` that came from the UNSIGNED userinfo response and
   * not from the signed ID token (components-F084.51, since 0.8.0). Sorted; an
   * empty list means everything in `claims` was signed (or userinfo was not
   * reached). When both sources carry a claim, the signed token's value wins
   * and the claim is not listed.
   *
   * On BID today this always contains "email" and "email_verified": the ID
   * token does not carry them (measured by broberg-id, 20 Sep 2026). A decision
   * that must rest on a signed identity binds on `claims.sub`, never on email.
   */
  unverifiedClaims: string[];
  idToken: string;
  accessToken?: string;
  refreshToken?: string;
  /** Seconds the access token lives, when BID said so (`expires_in`). */
  expiresIn?: number;
}

/**
 * `prompt=none` asks BID to answer WITHOUT showing anything (components-F084.6).
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
  /**
   * Does this address belong to the signed-in user's BID account, and is it
   * verified there? Asks BID's POST /api/app/address-ownership with the user's
   * access token. Throws SsoError on anything that is not one of the three
   * answers — see the implementation for why that must never become "unverified".
   */
  addressOwnership(accessToken: string, address: string): Promise<AddressOwnership>;
  /**
   * F095.1 — trade a refresh token for a new access token (`grant_type=refresh_token`).
   * Throws SsoError on refusal; the message carries the status and BID's error
   * code, never a token.
   */
  refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }>;
  /**
   * Invite users to BID on behalf of this app (the app's OWN key, `bidk_…`).
   * One result per email. Throws SsoError on anything BID did not clearly say.
   */
  inviteUsers(appKey: string, input: InviteUsersInput): Promise<InvitationResult[]>;
  /**
   * Where each user is in the move to BID. Throws SsoError on any state it does
   * not know — never a silent "ready", which would switch off a user's old login
   * while they cannot get in.
   */
  migrationStatus(appKey: string, emails: string[]): Promise<MigrationStatus>;
  /**
   * Verify an OIDC Back-Channel Logout token from BID («Log ud overalt»).
   * Throws SsoError on anything that is not a valid, sub-only logout token.
   */
  verifyLogoutToken(token: string): Promise<LogoutToken>;
  /**
   * F095.2 — the signed-in user's own profile (scope `profile`), with the user's
   * access token. Throws SsoAppApiError on any refusal.
   */
  getProfile(accessToken: string): Promise<BidProfile>;
  /** F095.2 — change the user's own name (scope `profile:write`). Returns the new profile. */
  updateProfile(accessToken: string, name: string): Promise<BidProfile>;
  /**
   * F095.2 — replace the user's picture (scope `profile:write`). Refuses more than
   * MAX_AVATAR_BYTES or a type outside AVATAR_TYPES with SsoAvatarRejectedError
   * BEFORE anything is sent.
   */
  uploadAvatar(accessToken: string, bytes: Uint8Array | ArrayBuffer, contentType: string): Promise<BidProfile>;
  /** F095.2 — remove the user's picture (scope `profile:write`). */
  removeAvatar(accessToken: string): Promise<BidProfile>;
  /** Exposed for tests and for a health check; not needed in normal use. */
  readonly jwks: JwksCache;
}

export type AddressOwnership = "verified" | "unverified" | "not_on_account";
const ADDRESS_OWNERSHIP = new Set<string>(["verified", "unverified", "not_on_account"]);

export type InvitationOutcome =
  | "invited"
  | "already_invited"
  | "existing"
  | "invalid"
  | "too_soon"
  | "too_many_today"
  | "send_failed";
const INVITATION_OUTCOMES = new Set<string>([
  "invited", "already_invited", "existing", "invalid", "too_soon", "too_many_today", "send_failed",
]);
export interface InviteUsersInput {
  customerName: string;
  appUrl: string;
  appName?: string;
  switchDate?: string;
  users: Array<{ email: string; name: string }>;
}
export interface InvitationResult {
  email: string;
  outcome: InvitationOutcome;
  mailId?: string;
  problem?: string;
}

export type MigrationState = "ready" | "invited" | "expired" | "not_invited";
const MIGRATION_STATES = new Set<string>(["ready", "invited", "expired", "not_invited"]);
export interface MigrationStatus {
  users: Array<{ email: string; state: MigrationState; expiresAt?: string }>;
  counts: Record<string, number>;
  complete: boolean;
}

/** A verified back-channel logout: every session for `sub` issued at or before `iat` is over. */
export interface LogoutToken {
  sub: string;
  iat: number;
  jti: string;
  exp: number;
}
const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/** BID's own limit per invitation call. */
export const MAX_INVITATIONS = 500;

export interface CreateSsoClientOptions {
  fetchImpl?: typeof fetch;
  /**
   * Ceiling for the app-API calls (addressOwnership, inviteUsers,
   * migrationStatus). A hanging BID must not hang the app. Default 10 000 ms.
   */
  timeoutMs?: number;
  /** Passed through to the key cache; see jwks.ts for why there is a floor. */
  minRefetchIntervalMs?: number;
}

/**
 * `invalid_client` is returned for two OPPOSITE mistakes, and the issuer cannot
 * tell you which — from outside they are the same three words.
 *
 *   we sent a secret, it was refused      → wrong secret, or we are registered
 *                                           as PUBLIC and should send none
 *   we sent none and it was demanded      → we are registered as CONFIDENTIAL
 *                                           and SSO_CLIENT_SECRET is unset
 *
 * The expensive version of this is the plugin storing the secret HASHED
 * (SHA-256 → base64url) and comparing hashes: write the plaintext through the
 * adapter and the row is written, reads back clean, and every token call is
 * refused forever. broberg-id paid for that one. We cannot see their storage
 * from here — but we CAN say what WE sent, which halves the search instead of
 * leaving a caller to guess which end to open.
 *
 * It states our SIDE, never the value. A secret must not reach a log line.
 */
/**
 * A fragment of a foreign response body, safe to put in a log line (components-F084.52).
 *
 * Three things it has to survive, and each one has bitten somebody:
 *
 *  · LENGTH — an HTML error page is kilobytes. A log line is not.
 *  · NEWLINES — a multi-line excerpt breaks every log aggregator that treats a
 *    line as a record, and the useful half is the part that scrolled away.
 *  · OUR OWN SECRET — the body comes from a server we do not control, and some
 *    servers echo the request back on an error. If our client_secret is in
 *    there, we must not be the ones who write it to disk.
 */
function excerptForLog(raw: string, clientSecret: string | undefined): string {
  let text = raw.replace(/\s+/g, " ").trim();
  if (clientSecret) text = text.split(clientSecret).join("[redacted client_secret]");
  if (text === "") return "(empty body)";
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function invalidClientHint(error: string | undefined, weSentASecret: boolean): string {
  if (error !== "invalid_client") return "";
  return weSentASecret
    ? " — we DID send a client_secret, so either it is wrong or this client is registered as PUBLIC (in which case unset SSO_CLIENT_SECRET)."
    : " — we sent NO client_secret, so this client is likely registered as CONFIDENTIAL (set SSO_CLIENT_SECRET to the value it was registered with).";
}

/**
 * The algorithms an ID token may be signed with. Asymmetric only, and stated
 * HERE rather than inferred from the token.
 *
 * ── WHY THIS LIST EXISTS WHEN NOTHING WAS EXPLOITABLE WITHOUT IT ──────────
 *
 * `alg` is read from the token's own protected header — that is, from whoever
 * sent it. Before this list, it was handed to importJWK and jwtVerify was
 * called with no restriction at all. Both classic forgeries were built and run
 * against this client in the security review of 2026-09-20:
 *
 *   HS256, signed with the PUBLIC key as the HMAC secret   → rejected
 *   alg: none                                              → rejected
 *   control: a genuine RS256 token                         → accepted
 *
 * So the package was NOT exploitable. But read the rejection: both failed with
 * `JOSENotSupported: Invalid or unsupported JWK "alg"`, thrown inside jose's
 * key import because an RSA JWK cannot be imported as an HMAC key. The defence
 * was a dependency's internals, not ours — it would move on a minor upgrade, or
 * the day an issuer publishes a symmetric key, and NOTHING here would go red.
 *
 * A guard you cannot see is a guard you cannot keep. Now jwtVerify refuses
 * first, and there is a test that fails if this list is widened.
 */
export const ALLOWED_ALGS = [
  // FIRST, because it is what Broberg ID actually signs with. Measured on the
  // live issuer 2026-09-20:
  //   /jwks      kid=Iodh… kty=OKP alg=EdDSA crv=Ed25519
  //   discovery  id_token_signing_alg_values_supported: ["EdDSA"]
  //
  // 0.2.1 SHIPPED THIS LIST WITHOUT IT and rejected every real token for an
  // hour. The list was written from what an OIDC client usually allows rather
  // than from what our issuer uses — and the whole suite missed it because the
  // fake issuer in the tests signs RS256. A fake agrees with whoever wrote it.
  // There is now a test that mints EdDSA, the algorithm production uses.
  "EdDSA",
  "RS256", "RS384", "RS512",
  "PS256", "PS384", "PS512",
  "ES256", "ES384", "ES512",
];

export function createSsoClient(
  config: SsoConfig,
  options: CreateSsoClientOptions = {},
): SsoClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  /** POST to one of BID's app-API routes: bounded in time, JSON in and out, loud on failure. */
  async function appPost(path: string, bearer: string, payload: unknown, what: string): Promise<unknown> {
    const url = new URL(path, config.issuer).toString();
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new SsoError(`${url} did not answer within ${timeoutMs} ms — ${what} is unknown.`));
      }, timeoutMs);
    });
    try {
      const res = await Promise.race([
        fetchImpl(url, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        }),
        timedOut,
      ]);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const hint = detail.includes("invalid_app_key") ? " (invalid_app_key: this app's bidk_ key was refused)" : "";
        throw new SsoError(`${url} answered ${res.status}${hint} — ${what} is unknown.`);
      }
      return await Promise.race([res.json().catch(() => null), timedOut]);
    } catch (e) {
      if (e instanceof SsoError) throw e;
      throw new SsoError(`${url} could not be reached: ${e instanceof Error ? e.message : String(e)} — ${what} is unknown.`);
    } finally {
      clearTimeout(timer);
    }
  }
  /**
   * F095.2 — the general app-API call beside appPost (which stays as it is):
   * any method, a JSON or raw-bytes body, bounded in time, STATUS FIRST, and
   * BID's `error` code surfaced as SsoAppApiError rather than lost. The message
   * names the URL, status and code only — the body is never quoted, because the
   * request carried the user's token and an echoing server would put it in a log.
   */
  async function appRequest(
    path: string,
    bearer: string,
    init: { method: "GET" | "POST"; json?: unknown; bytes?: Uint8Array | ArrayBuffer; contentType?: string },
    what: string,
  ): Promise<unknown> {
    const url = new URL(path, config.issuer).toString();
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Reject BEFORE aborting: the abort makes fetch reject too, and the race
        // must be won by the reason that names the timeout.
        reject(new SsoAppApiError(`${url} did not answer within ${timeoutMs} ms — ${what} is unknown.`, null, undefined));
        ctrl.abort();
      }, timeoutMs);
    });
    const headers: Record<string, string> = { authorization: `Bearer ${bearer}` };
    let body: BodyInit | undefined;
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init.bytes !== undefined) {
      headers["content-type"] = init.contentType ?? "application/octet-stream";
      body = init.bytes as BodyInit;
    }
    try {
      const res = await Promise.race([
        fetchImpl(url, { method: init.method, headers, ...(body !== undefined ? { body } : {}), signal: ctrl.signal }),
        timedOut,
      ]);
      const raw = await Promise.race([res.text(), timedOut]);
      let parsed: unknown;
      try {
        parsed = raw.trim() === "" ? undefined : JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
      const fields = (parsed && typeof parsed === "object" ? parsed : {}) as { error?: unknown; scope?: unknown };
      const code = typeof fields.error === "string" ? fields.error : undefined;
      // Status FIRST: a refusal is a refusal whatever its body looks like.
      if (!res.ok) {
        if (res.status === 403 && code === "insufficient_scope") {
          const scope =
            typeof fields.scope === "string" && fields.scope ? fields.scope : init.method === "GET" ? "profile" : "profile:write";
          throw new SsoInsufficientScopeError(
            `${url} answered 403 insufficient_scope — the user's token lacks scope "${scope}"; log in again with it requested.`,
            scope,
          );
        }
        throw new SsoAppApiError(`${url} answered ${res.status}${code ? ` (${code})` : ""} — ${what} is unknown.`, res.status, code);
      }
      if (parsed === undefined) {
        throw new SsoAppApiError(`${url} answered ${res.status} with a body that is not JSON — ${what} is unknown.`, res.status, undefined);
      }
      return parsed;
    } catch (e) {
      if (e instanceof SsoError) throw e;
      // The name only, not the message: a fetch error's message can quote the request.
      throw new SsoAppApiError(`${url} could not be reached (${e instanceof Error ? e.name : "error"}) — ${what} is unknown.`, null, undefined);
    } finally {
      clearTimeout(timer);
    }
  }

  /** A profile body, or SsoAppApiError — never a half-filled object passed off as one. */
  function asProfile(body: unknown, path: string): BidProfile {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.sub !== "string" || b.sub === "" || typeof b.account_url !== "string") {
      throw new SsoAppApiError(`${path} returned no "sub" or "account_url" — the profile is unknown.`, 200, undefined);
    }
    const opt = (v: unknown) => (typeof v === "string" ? v : null);
    return { sub: b.sub, name: opt(b.name), picture: opt(b.picture), email: opt(b.email), account_url: b.account_url };
  }

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
      // THE CHECK THAT WOULD HAVE TURNED 0.2.1'S OUTAGE INTO A SENTENCE.
      //
      // An allow-list that omits the algorithm the issuer actually uses does
      // not fail loudly: every token is refused, one at a time, with a message
      // about that token. The app looks broken, the issuer looks broken, and
      // nothing names the real cause. That is what 0.2.1 did for an hour.
      //
      // The issuer already publishes the answer. If it advertises its signing
      // algorithms and NONE of them are ones we accept, that is knowable here —
      // once, at first use — instead of being rediscovered on every login.
      //
      // Deliberately narrow: it fires only on an EMPTY intersection. An issuer
      // that supports one algorithm we allow and three we do not is perfectly
      // workable, and refusing to start there would be a second outage dressed
      // as caution.
      const advertised = doc.id_token_signing_alg_values_supported;
      if (Array.isArray(advertised) && advertised.length > 0) {
        const usable = advertised.filter((a) => ALLOWED_ALGS.includes(a));
        if (usable.length === 0) {
          throw new SsoError(
            `${config.issuer} signs ID tokens with ${advertised.join(", ")}, and this client ` +
              `accepts none of those (it allows ${ALLOWED_ALGS.join(", ")}). Every token would be ` +
              `rejected. This is a mismatch between the package and the issuer — report it rather ` +
              `than working around it.`,
          );
        }
      }

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

  /**
   * OIDC Back-Channel Logout 1.0 §2.6, plus one rule of our own: a token that
   * carries `sid` is REFUSED. BID sends sub-only tokens, and only from «Log ud
   * overalt» — the ordinary «Log ud» must not reach the apps (decision D-376ffa).
   * better-auth fires sid-tokens on every session deletion; accepting one here
   * would quietly turn BID's own logout into a fleet-wide one if that hook were
   * ever wired up.
   */
  async function verifyLogoutToken(token: string): Promise<LogoutToken> {
    const cache = await keys();
    let header;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new SsoError("logout_token is not a JWS");
    }
    if (!header.kid) throw new SsoError("logout_token has no kid — cannot pick a signing key");
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, async () => cache.getKey(header.kid!, header.alg ?? "RS256"), {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: ALLOWED_ALGS,
        typ: "logout+jwt",
        requiredClaims: ["iat", "exp", "jti"],
      }));
    } catch (e) {
      throw new SsoError(`logout_token rejected: ${e instanceof Error ? e.message : String(e)}`);
    }
    const events = payload.events as Record<string, unknown> | undefined;
    if (!events || typeof events !== "object" || !(BACKCHANNEL_EVENT in events)) {
      throw new SsoError("logout_token has no back-channel logout event");
    }
    if ("nonce" in payload) throw new SsoError("logout_token carries a nonce — that is an ID token, not a logout token");
    if ("sid" in payload) {
      throw new SsoError("logout_token carries sid — only sub-wide «Log ud overalt» is accepted (D-376ffa)");
    }
    if (typeof payload.sub !== "string" || payload.sub === "") throw new SsoError("logout_token has no sub");
    return { sub: payload.sub, iat: payload.iat!, jti: String(payload.jti), exp: payload.exp! };
  }

  async function verifyIdToken(idToken: string, opts: { nonce?: string } = {}) {
    const cache = await keys();
    const header = decodeProtectedHeader(idToken);
    if (!header.kid) throw new SsoError("ID token has no kid — cannot pick a signing key");

    const { payload } = await jwtVerify(
      idToken,
      async () => cache.getKey(header.kid!, header.alg ?? "RS256"),
      { issuer: config.issuer, audience: config.clientId, algorithms: ALLOWED_ALGS },
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
  async function withUserInfo(
    claims: SsoClaims,
    accessToken: string,
  ): Promise<{ claims: SsoClaims; unverifiedClaims: string[] }> {
    const doc = await discovery();
    if (!doc.userinfo_endpoint) return { claims, unverifiedClaims: [] };

    const res = await fetchImpl(doc.userinfo_endpoint, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    // A failure here must NOT lose the sign-in: the identity is already proven
    // by the ID token. The user ends up with a session and no display name,
    // which is worse than having one and far better than being logged out.
    if (!res.ok) return { claims, unverifiedClaims: [] };

    const info = (await res.json()) as Record<string, unknown>;
    if (info.sub !== claims.sub) {
      throw new SsoError(
        `userinfo describes ${String(info.sub)} but the ID token is for ${claims.sub} — ` +
          `refusing to merge another user's profile onto this session.`,
      );
    }
    // components-F084.51 — THE SIGNED TOKEN WINS, and what it did not carry is
    // NAMED. Userinfo is an unsigned HTTP response: it may FILL a hole the token
    // left, never overwrite a claim the token signed. Every key it filled is
    // listed in `unverifiedClaims`, so a consumer gating on email_verified can
    // see the value was never signed — which on BID it never is today (measured
    // by broberg-id, 20 Sep 2026: email + email_verified exist only in userinfo).
    const unverifiedClaims = Object.keys(info)
      .filter((k) => k !== "sub" && info[k] !== undefined && !(k in claims))
      .sort();
    return { claims: { ...info, ...claims, sub: claims.sub }, unverifiedClaims };
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
          // ALWAYS sent, secret or not. See SsoConfig.clientSecret: the two
          // prove different things, so a confidential client keeps PKCE.
          code_verifier: codeVerifier,
          ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
        }),
      });

      // STATUS FIRST, PARSE SECOND — and the order IS the fix (components-F084.52).
      //
      // This used to be `await res.json()`, which runs BEFORE the `if (!res.ok)`
      // below. So when the issuer answered with something that is not JSON — an
      // empty 500 body, an HTML error page from a proxy, a gateway timeout — the
      // parse threw `SyntaxError: Unexpected end of JSON input` and the careful
      // message underneath was never reached. In the one case it exists for.
      //
      // The cost is not cosmetic. BID's own public guide (id.broberg.ai/docs §4b)
      // tells every consumer to wrap completeLogin in try/catch and redirect
      // instead of returning 500, so this string is ALL a consumer has: the user
      // sees a redirect, and the diagnosis lives only in what they logged. A line
      // reading "Unexpected end of JSON input" sends that reader into their own
      // code to look for a fault that is in the server.
      //
      // Reported by broberg-id, who measured production first: a real
      // `POST /oauth2/token` with a bad code answers 400 + JSON, so the good path
      // was never affected. This only fires against a broken or outdated issuer —
      // which is exactly where somebody is already debugging.
      //
      // NOT a try/catch around res.json(): that catches the throw and still loses
      // res.status, which is the one fact that says WHICH end is at fault.
      const raw = await res.text();
      let body: {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };
      try {
        body = raw.trim() === "" ? {} : (JSON.parse(raw) as typeof body);
      } catch {
        throw new SsoError(
          `token exchange failed (${res.status}): the response body is not JSON` +
            `${res.headers.get("content-type") ? ` (content-type: ${res.headers.get("content-type")})` : ""}` +
            ` — ${excerptForLog(raw, config.clientSecret)}`,
        );
      }
      // An EMPTY body parses to {} and falls through to the check below, which
      // reports the status and "no id_token in response" — right for a 500 with
      // no body, and right for a 200 that returned nothing.
      if (!res.ok || !body.id_token) {
        throw new SsoError(
          `token exchange failed (${res.status}): ${body.error ?? "no id_token in response"}` +
            (body.error_description ? ` — ${body.error_description}` : "") +
            invalidClientHint(body.error, config.clientSecret !== undefined),
        );
      }

      const claims = await verifyIdToken(body.id_token, { nonce });

      const merged = body.access_token
        ? await withUserInfo(claims, body.access_token)
        : { claims, unverifiedClaims: [] };
      return {
        claims: merged.claims,
        unverifiedClaims: merged.unverifiedClaims,
        idToken: body.id_token,
        ...(body.access_token ? { accessToken: body.access_token } : {}),
        ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
        ...(typeof body.expires_in === "number" ? { expiresIn: body.expires_in } : {}),
      };
    },

    async refreshTokens(refreshToken) {
      const { token_endpoint } = await discovery();
      const res = await fetchImpl(token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: config.clientId,
          ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
        }),
      });
      // Status first, parse second (the F084.52 order). The message names the
      // status and BID's error code ONLY — the raw body is not quoted here,
      // because this request carried a refresh token and an excerpt is one
      // careless server away from echoing it into a log.
      const raw = await res.text();
      let body: { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
      try {
        body = raw.trim() === "" ? {} : (JSON.parse(raw) as typeof body);
      } catch {
        throw new SsoError(`token refresh failed (${res.status}): the response body is not JSON`);
      }
      if (!res.ok || typeof body.access_token !== "string" || body.access_token === "") {
        throw new SsoError(`token refresh failed (${res.status}): ${body.error ?? "no access_token in response"}`);
      }
      return {
        accessToken: body.access_token,
        ...(typeof body.refresh_token === "string" && body.refresh_token ? { refreshToken: body.refresh_token } : {}),
        ...(typeof body.expires_in === "number" ? { expiresIn: body.expires_in } : {}),
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

    async addressOwnership(accessToken, address) {
      // An app-API route on BID's origin, not an OIDC endpoint, so it is not in
      // discovery. Origin-relative: the issuer may carry a path.
      const body = (await appPost(
        "/api/app/address-ownership",
        accessToken,
        { address },
        'address ownership (not "unverified")',
      )) as { status?: unknown } | null;
      // Anything but the three answers THROWS. Mapping a malformed or new status
      // to "unverified" would quietly downgrade a real user's verified address,
      // and nothing about that looks broken from the outside.
      const status = body?.status;
      if (typeof status !== "string" || !ADDRESS_OWNERSHIP.has(status)) {
        throw new SsoError(`address-ownership returned status ${JSON.stringify(status)} — expected verified, unverified or not_on_account.`);
      }
      return status as AddressOwnership;
    },

    verifyLogoutToken,

    async getProfile(accessToken) {
      const path = "/api/app/profile";
      return asProfile(await appRequest(path, accessToken, { method: "GET" }, "the profile"), path);
    },

    async updateProfile(accessToken, name) {
      const path = "/api/app/profile";
      return asProfile(await appRequest(path, accessToken, { method: "POST", json: { name } }, "the new name"), path);
    },

    async uploadAvatar(accessToken, bytes, contentType) {
      // Both refusals BEFORE the request: a picture BID will refuse is not worth
      // 2 MB of upload, and the user gets a reason instead of BID's status.
      const type = mediaType(contentType);
      if (!AVATAR_TYPES.includes(type)) {
        throw new SsoAvatarRejectedError(
          `uploadAvatar: "${type}" is not accepted — BID takes ${AVATAR_TYPES.join(", ")}.`,
          "unsupported_type",
        );
      }
      if (bytes.byteLength > MAX_AVATAR_BYTES) {
        throw new SsoAvatarRejectedError(
          `uploadAvatar: ${bytes.byteLength} bytes — BID takes at most ${MAX_AVATAR_BYTES}.`,
          "too_large",
        );
      }
      const path = "/api/app/profile/avatar";
      return asProfile(await appRequest(path, accessToken, { method: "POST", bytes, contentType: type }, "the new picture"), path);
    },

    async removeAvatar(accessToken) {
      const path = "/api/app/profile/avatar/remove";
      return asProfile(await appRequest(path, accessToken, { method: "POST" }, "the removed picture"), path);
    },

    async inviteUsers(appKey, input) {
      if (input.users.length > MAX_INVITATIONS) {
        throw new SsoError(`inviteUsers: ${input.users.length} users, BID accepts at most ${MAX_INVITATIONS} per call.`);
      }
      const body = (await appPost("/api/app/invitations", appKey, input, "the invitation outcome")) as {
        results?: unknown;
      } | null;
      if (!Array.isArray(body?.results)) {
        throw new SsoError(`invitations returned no "results" array — the invitation outcome is unknown.`);
      }
      for (const r of body.results as Array<{ email?: unknown; outcome?: unknown }>) {
        if (typeof r?.outcome !== "string" || !INVITATION_OUTCOMES.has(r.outcome)) {
          throw new SsoError(`invitations returned outcome ${JSON.stringify(r?.outcome)} for ${String(r?.email)} — not one this client knows.`);
        }
      }
      return body.results as InvitationResult[];
    },

    async migrationStatus(appKey, emails) {
      const body = (await appPost("/api/app/migration-status", appKey, { emails }, "the migration state")) as {
        users?: unknown;
        counts?: unknown;
        complete?: unknown;
      } | null;
      if (!Array.isArray(body?.users) || typeof body.complete !== "boolean") {
        throw new SsoError(`migration-status returned no "users" array or no "complete" flag — the migration state is unknown.`);
      }
      for (const u of body.users as Array<{ email?: unknown; state?: unknown }>) {
        if (typeof u?.state !== "string" || !MIGRATION_STATES.has(u.state)) {
          throw new SsoError(`migration-status returned state ${JSON.stringify(u?.state)} for ${String(u?.email)} — never read as "ready".`);
        }
      }
      return body as MigrationStatus;
    },
  };
}

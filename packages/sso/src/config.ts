/**
 * Configuration, read from the environment and nowhere else (F084.4 AC#5).
 *
 * An app mounts this package and sets env vars. It does not pass options in
 * code, because the moment configuration lives in code, two deployments of the
 * same app can disagree about who their identity provider is — and the symptom
 * is a token rejection nobody can trace back to a config line.
 */

export class SsoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsoConfigError";
  }
}

export interface SsoConfig {
  /** BrobergID's origin, e.g. https://id.broberg.ai — the BARE origin. */
  issuer: string;
  /** The client id this app was registered under (administratively, in BID). */
  clientId: string;
  /** Exactly the redirect registered in BID. Exact match — one character decides. */
  redirectUri: string;
  /** Requested scopes. */
  scopes: string[];
  /** Signs the local session cookie. 32+ bytes of randomness. */
  cookieSecret: string;
  /** Local session cookie name. */
  cookieName: string;
  /**
   * How long this app trusts its OWN session — the ONE knob (components-F084.163).
   *
   * The numbers are the owner's (Decision Register D-38a092) and live in
   * SESSION_PROFILES, never in env or an adapter:
   * - "standard" (default): 7 days, ROLLING — every use renews it.
   * - "sensitive": 30 minutes of inactivity, and never more than 12 hours
   *   after login however active. For anything holding personal or health data.
   *
   * Replaces `sessionMaxAge` / SSO_SESSION_MAX_AGE (0.24.0): a free number let
   * each app pick its own, which is how a patient app could end up on 7 days.
   */
  sessionProfile: SessionProfile;
  /** Where to send the browser after a logout completes. */
  postLogoutRedirectUri?: string;
  /**
   * Set ONLY by an app that can actually keep a secret — one whose callback
   * runs on a server. Leave it unset for anything shipped to a browser; a
   * secret in a static bundle is not a secret, and PKCE alone is the correct,
   * fully standard design there.
   *
   * Setting it makes this a CONFIDENTIAL client: the secret is sent as
   * `client_secret_post` (in the body), which is the method BID registers
   * confidential clients with.
   *
   * IT DOES NOT RELAX PKCE. A secret proves which APP is asking; the PKCE
   * verifier proves the request belongs to the browser that started the login.
   * They defend against different attacks, so one is never an excuse to drop
   * the other — and there is a test that fails if anyone makes it one.
   */
  clientSecret?: string;
  /**
   * components-F084.181 — how this app proves itself at BID's token endpoint.
   * "secret" (default): `client_secret` as above, exactly as before.
   * "fly": no secret. The app fetches an OIDC token from Fly's machine API with
   * `aud` = BID's token endpoint and sends it as a `client_assertion`
   * (BID F084.180). BID must have this client registered as `fly_oidc`, bound to
   * this Fly org and app. If the Fly token cannot be fetched the login FAILS —
   * there is no fallback to `clientSecret` at the token endpoint.
   * `clientSecret` is still used where BID needs it outside the token endpoint
   * (introspection, the embedded login).
   */
  clientAuth?: "secret" | "fly";
}

/**
 * NOT `!value`. A blank string is falsy in JavaScript, so the obvious guard
 * lets `SSO_COOKIE_SECRET="   "` boot an app whose sessions are signed with
 * whitespace. This fleet has measured that exact defect before (components
 * F004.7), which is why it is a trim-and-compare rather than a truthiness test.
 */
function required(env: NodeJS.ProcessEnv, name: string, hint: string): string {
  const raw = env[name];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new SsoConfigError(`${name} is not set (or is blank). ${hint}`);
  }
  return raw.trim();
}

function parseClientAuth(raw: string | undefined): "secret" | "fly" | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  if (v === "secret" || v === "fly") return v;
  throw new SsoConfigError(`SSO_CLIENT_AUTH must be "secret" or "fly" (got ${JSON.stringify(raw)}).`);
}

export type SessionProfile = "standard" | "sensitive";

/**
 * components-F084.163 — the fleet's session lifetimes, in seconds, decided by
 * the owner 16/9 (D-38a092). ONE place. A test fails if any other code path
 * can set a session length.
 */
export const SESSION_PROFILES = {
  standard: { rolling: 60 * 60 * 24 * 7 },
  sensitive: { idle: 60 * 30, absolute: 60 * 60 * 12 },
} as const;

/** How often a live session asks BID whether its login still stands. */
export const SILENT_CHECK_INTERVAL = 60 * 60;

/** Seconds in a week — kept as an export for 0.23 importers; the value is SESSION_PROFILES.standard.rolling. */
export const DEFAULT_SESSION_MAX_AGE = SESSION_PROFILES.standard.rolling;

export function parseSessionProfile(raw: unknown, source: string): SessionProfile {
  const v = typeof raw === "string" ? raw.trim() : raw;
  if (v === undefined || v === "") return "standard";
  if (v === "standard" || v === "sensitive") return v;
  throw new SsoConfigError(`${source} must be "standard" or "sensitive" (got ${JSON.stringify(raw)}).`);
}

export function loadSsoConfig(env: NodeJS.ProcessEnv = process.env): SsoConfig {
  const rawIssuer = required(
    env,
    "BID_ISSUER",
    "It is BID's bare origin, e.g. https://id.broberg.ai",
  );

  let issuer: string;
  try {
    const url = new URL(rawIssuer);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new SsoConfigError(
        `BID_ISSUER must be https (got ${url.protocol}//). Only localhost may be http.`,
      );
    }
    // Normalised to the origin: a trailing slash makes it a DIFFERENT issuer to
    // a strict OIDC client, and the mismatch surfaces as an opaque token
    // rejection rather than as a configuration error anyone can read.
    issuer = url.origin;
  } catch (err) {
    if (err instanceof SsoConfigError) throw err;
    throw new SsoConfigError(`BID_ISSUER is not a valid URL: ${rawIssuer}`);
  }

  const cookieSecret = required(
    env,
    "SSO_COOKIE_SECRET",
    "Generate one with `openssl rand -hex 32`. It signs this app's session cookie.",
  );
  if (cookieSecret.length < 32) {
    throw new SsoConfigError(
      `SSO_COOKIE_SECRET is ${cookieSecret.length} characters; it must be at least 32. ` +
        "A short secret is a forgeable session, and a forged session is any user you like.",
    );
  }

  // components-F084.163 — a free number is exactly what the profile replaced.
  // Refused loudly rather than ignored: an app that set 43200 for patient data
  // must not silently fall back to 7 days.
  if (env.SSO_SESSION_MAX_AGE !== undefined && env.SSO_SESSION_MAX_AGE.trim() !== "") {
    throw new SsoConfigError(
      "SSO_SESSION_MAX_AGE is gone (0.24.0). Set SSO_SESSION_PROFILE=sensitive for personal or health data " +
        "(30 min idle, max 12 h), or leave it unset for standard (7 days, renewed on use). The numbers are fixed fleet-wide.",
    );
  }
  const sessionProfile = parseSessionProfile(env.SSO_SESSION_PROFILE, "SSO_SESSION_PROFILE");

  return {
    issuer,
    clientId: required(env, "SSO_CLIENT_ID", "The id this app is registered under in BID."),
    redirectUri: required(
      env,
      "SSO_REDIRECT_URI",
      "Must match the registered redirect EXACTLY — one trailing slash is a different address.",
    ),
    scopes: (env.SSO_SCOPES?.trim() || "openid profile email").split(/\s+/),
    cookieSecret,
    cookieName: env.SSO_COOKIE_NAME?.trim() || "bid_session",
    sessionProfile,
    postLogoutRedirectUri: env.SSO_POST_LOGOUT_REDIRECT_URI?.trim() || undefined,
    clientSecret: env.SSO_CLIENT_SECRET?.trim() || undefined,
    clientAuth: parseClientAuth(env.SSO_CLIENT_AUTH),
  };
}

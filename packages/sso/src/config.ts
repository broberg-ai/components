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
  /** Broberg ID's origin, e.g. https://id.broberg.ai — the BARE origin. */
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
   * How long this app trusts its OWN session, in seconds.
   *
   * F084.7 decided the fleet's numbers: 7 days for a normal app, and 12 hours
   * + 30 minutes of inactivity for anything holding personal or health data.
   * The default here is the 7 days. An app handling patient data MUST set
   * SSO_SESSION_MAX_AGE=43200 — the default is a normal-app default, not a
   * safe-for-everything one.
   */
  sessionMaxAge: number;
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

/** Seconds in a week — the fleet default from F084.7. */
export const DEFAULT_SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export function loadSsoConfig(env: NodeJS.ProcessEnv = process.env): SsoConfig {
  const rawIssuer = required(
    env,
    "BID_ISSUER",
    "It is Broberg ID's bare origin, e.g. https://id.broberg.ai",
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

  const rawMaxAge = env.SSO_SESSION_MAX_AGE?.trim();
  let sessionMaxAge = DEFAULT_SESSION_MAX_AGE;
  if (rawMaxAge) {
    const n = Number(rawMaxAge);
    // A non-number here would silently become NaN and then a cookie that
    // expires immediately — an app that cannot keep anyone logged in, with no
    // error anywhere. Refuse instead.
    if (!Number.isFinite(n) || n <= 0) {
      throw new SsoConfigError(
        `SSO_SESSION_MAX_AGE must be a positive number of seconds (got ${JSON.stringify(rawMaxAge)}).`,
      );
    }
    sessionMaxAge = Math.floor(n);
  }

  return {
    issuer,
    clientId: required(env, "SSO_CLIENT_ID", "The id this app is registered under in Broberg ID."),
    redirectUri: required(
      env,
      "SSO_REDIRECT_URI",
      "Must match the registered redirect EXACTLY — one trailing slash is a different address.",
    ),
    scopes: (env.SSO_SCOPES?.trim() || "openid profile email").split(/\s+/),
    cookieSecret,
    cookieName: env.SSO_COOKIE_NAME?.trim() || "bid_session",
    sessionMaxAge,
    postLogoutRedirectUri: env.SSO_POST_LOGOUT_REDIRECT_URI?.trim() || undefined,
    clientSecret: env.SSO_CLIENT_SECRET?.trim() || undefined,
  };
}

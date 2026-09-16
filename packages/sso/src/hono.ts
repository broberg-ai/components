/**
 * The Hono adapter — mounting, and nothing else.
 *
 * Every rule about what a valid session IS lives in the core (client.ts,
 * session.ts). This file only turns those into routes. F084.5 adds a Next.js
 * adapter on the SAME core, because a rule implemented twice is a rule that
 * eventually says two things.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { loadSsoConfig, type SsoConfig } from "./config.js";
import { createSsoClient, type SsoClient } from "./client.js";
import {
  cookieHeader,
  readCookie,
  signSession,
  signValue,
  verifySession,
  verifyValue,
  type SessionPayload,
} from "./session.js";

/** Where the adapter parks the session on the request, for `getSession`. */
const SESSION_KEY = "bidSession";

/** Short-lived cookie holding the in-flight login. Five minutes is plenty for
 *  a person to type a password; longer just widens the window. */
const TRANSACTION_MAX_AGE = 300;

export interface SsoRoutesOptions {
  config?: SsoConfig;
  client?: SsoClient;
  /** Path prefix these routes are mounted under. Used to build the return URL. */
  loginPath?: string;
  /** Where to send a user after a successful login when no returnTo is given. */
  defaultReturnTo?: string;
}

function isSecure(c: Context): boolean {
  // localhost over http is the one case where a Secure cookie would simply
  // never be stored, making local development impossible for a reason no error
  // would explain.
  return new URL(c.req.url).protocol === "https:";
}

/**
 * Only same-origin, path-only return targets are honoured.
 *
 * Without this, `/auth/login?returnTo=https://evil.example` turns this app's
 * own login into an open redirect that arrives wearing our domain — the
 * classic phishing lever, and it is one line to close.
 */
function safeReturnTo(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

export function ssoRoutes(options: SsoRoutesOptions = {}) {
  const config = options.config ?? loadSsoConfig();
  const client = options.client ?? createSsoClient(config);
  const loginPath = options.loginPath ?? "/auth";
  const defaultReturnTo = options.defaultReturnTo ?? "/";
  const txCookie = `${config.cookieName}_tx`;

  const app = new Hono();

  app.get("/login", async (c) => {
    const prompt = c.req.query("prompt");
    const start = await client.beginLogin(
      prompt === "none" ? { prompt: "none" } : {},
    );
    const tx = JSON.stringify({
      state: start.state,
      codeVerifier: start.codeVerifier,
      nonce: start.nonce,
      returnTo: safeReturnTo(c.req.query("returnTo"), defaultReturnTo),
    });
    c.header(
      "Set-Cookie",
      cookieHeader(txCookie, await signValue(tx, config.cookieSecret), {
        maxAge: TRANSACTION_MAX_AGE,
        secure: isSecure(c),
      }),
    );
    // A FULL top-level redirect. Never a hidden iframe — see client.ts.
    return c.redirect(start.url, 302);
  });

  app.get("/callback", async (c) => {
    const parsed = await parseTransaction(
      readCookie(c.req.header("cookie"), txCookie),
      config.cookieSecret,
    );
    if (!parsed) {
      return c.json(
        { error: "no_login_in_progress", message: "This browser did not start a login here, or it expired." },
        400,
      );
    }

    const result = await client.completeLogin({
      params: new URL(c.req.url).searchParams,
      state: parsed.state,
      codeVerifier: parsed.codeVerifier,
      nonce: parsed.nonce,
    });

    const exp = Math.floor(Date.now() / 1000) + config.sessionMaxAge;
    const session: SessionPayload = {
      sub: result.claims.sub,
      exp,
      ...(result.claims.email ? { email: result.claims.email } : {}),
      ...(result.claims.name ? { name: result.claims.name } : {}),
      ...(result.claims.picture ? { picture: result.claims.picture } : {}),
    };

    c.header(
      "Set-Cookie",
      cookieHeader(config.cookieName, await signSession(session, config.cookieSecret), {
        maxAge: config.sessionMaxAge,
        secure: isSecure(c),
      }),
    );
    // Clear the transaction cookie: it has done its job, and a replayed one is
    // only ever useful to someone who should not have it.
    c.header(
      "Set-Cookie",
      cookieHeader(txCookie, "", { maxAge: 0, secure: isSecure(c) }),
      { append: true },
    );
    return c.redirect(parsed.returnTo, 302);
  });

  app.get("/logout", async (c) => {
    c.header(
      "Set-Cookie",
      cookieHeader(config.cookieName, "", { maxAge: 0, secure: isSecure(c) }),
    );
    // Local cookie cleared FIRST, then central logout. If the redirect to BID
    // fails or the user closes the tab, the worst case is "signed out here but
    // not everywhere" — never the reverse, which would leave this app trusting
    // a session the user believes is gone.
    return c.redirect(await client.logoutUrl(), 302);
  });

  /** Reads the session and puts it on the context. Never blocks. */
  const attach: MiddlewareHandler = async (c, next) => {
    const cookie = readCookie(c.req.header("cookie"), config.cookieName);
    c.set(SESSION_KEY, await verifySession(cookie, config.cookieSecret));
    await next();
  };

  /** Blocks and redirects to login, preserving where the user was going. */
  const require: MiddlewareHandler = async (c, next) => {
    const cookie = readCookie(c.req.header("cookie"), config.cookieName);
    const session = await verifySession(cookie, config.cookieSecret);
    if (!session) {
      const url = new URL(c.req.url);
      return c.redirect(
        `${loginPath}/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`,
        302,
      );
    }
    c.set(SESSION_KEY, session);
    await next();
  };

  return { app, attach, require, client, config };
}

/**
 * Reads the login transaction back out of its signed cookie.
 *
 * Signature only — the transaction's lifetime is the cookie's own Max-Age, not
 * a claim inside it. That is why it does NOT go through verifySession: an
 * envelope carrying an `exp` would need one, and the first version of this file
 * used `exp: 0`, which the expiry check rejected every time.
 */
async function parseTransaction(raw: string | undefined, secret: string) {
  const body = await verifyValue(raw, secret);
  if (body === null) return null;
  try {
    const tx = JSON.parse(body) as {
      state: string;
      codeVerifier: string;
      nonce: string;
      returnTo: string;
    };
    if (!tx.state || !tx.codeVerifier || !tx.nonce) return null;
    return tx;
  } catch {
    return null;
  }
}

/** Read the session a middleware attached. */
export function getSession(c: Context): SessionPayload | null {
  return (c.get(SESSION_KEY) as SessionPayload | null) ?? null;
}

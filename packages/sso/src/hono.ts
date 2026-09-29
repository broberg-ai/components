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
import { createSsoClient, SsoError, type SsoClient } from "./client.js";
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

/**
 * How long the SERVER will accept an in-flight login. Five minutes is plenty
 * for a person to type a password; longer just widens the window. This is the
 * real limit: it is enforced in `parseTransaction`, on a timestamp inside the
 * signature, so no client can talk its way past it.
 */
const TRANSACTION_MAX_AGE = 300;

/**
 * How long the BROWSER keeps the cookie — deliberately LONGER than the window
 * above, and the two numbers must never be collapsed back into one.
 *
 * A cookie the browser has already dropped NEVER ARRIVES. With one number for
 * both, the moment the window passes there is simply nothing in the request,
 * and the server cannot tell "she took too long" from "she never started a
 * login here". Those are different things that deserve different answers, and
 * collapsing them cost a diagnosis: this adapter used to answer every failed
 * callback with one message containing the word "or".
 *
 * Reported by helpdesk (2026-09-22, components-F084.54), who run 3x in
 * production for exactly this reason. The extra time is INERT — `parseTransaction`
 * refuses anything past TRANSACTION_MAX_AGE and /callback clears the cookie, so
 * a verifier that cannot be exchanged is not a key. It buys diagnosis, not
 * lifetime.
 */
const TRANSACTION_COOKIE_MAX_AGE = TRANSACTION_MAX_AGE * 3;

/**
 * Where «Log ud overalt» is remembered (F084.151). The APP provides it, backed by
 * something every instance shares — apps run on two machines, so a per-process
 * list would log the user out on one machine and not the other. There is
 * deliberately no in-memory default.
 */
export interface BackchannelStore {
  /** Every session for `sub` minted at or before `iat` is over. Keep the LATEST iat. */
  revokeSubBefore(sub: string, iat: number): Promise<void>;
  /** The iat recorded for `sub`, or null. */
  revokedBefore(sub: string): Promise<number | null>;
  /** Record a logout token id; true the FIRST time, false for a replay. Keep it until `until` (unix s). */
  useJti(jti: string, until: number): Promise<boolean>;
}

export interface BackchannelOptions {
  store: BackchannelStore;
  /**
   * When the store cannot answer: "reject" (default) treats the user as logged
   * out; "allow" lets the session through unchecked. «reject» is the secure
   * choice — a user who pressed «Log ud overalt» must not stay in because a
   * database hiccupped — at the price of everyone being out while it lasts.
   */
  onStoreError?: "reject" | "allow";
}

export interface SsoRoutesOptions {
  /**
   * What «Log ud» in the app does (F084.152).
   * "app" (default): end THIS app's session and send the user to BID's login
   *   dialog (prompt=login). They stay signed in to BID — its own «Log ud» is
   *   a separate action (decision D-376ffa) — and BID shows the dialog anyway.
   * "central": the pre-0.7.0 behaviour — RP-initiated logout at BID's
   *   end-session endpoint, which also ends the BID session.
   */
  logout?: "app" | "central";
  /**
   * Receive «Log ud overalt» from BID at POST <mount>/backchannel-logout.
   * Nothing arrives until BID has registered that URL for this app (ship dark),
   * so mounting it early is safe.
   */
  backchannel?: BackchannelOptions;
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
/**
 * An origin nothing can resolve to. Only used as a yardstick: if a candidate
 * still sits on THIS origin after parsing, it is same-origin wherever the app
 * actually lives.
 */
const YARDSTICK = "https://sso.invalid";

/**
 * Only same-origin, path-only return targets are honoured.
 *
 * ── WHY THIS ASKS A PARSER INSTEAD OF INSPECTING CHARACTERS ───────────────
 *
 * The first version of this function rejected a leading `//` and required a
 * leading `/`. That is the obvious rule, it reads as correct, and it was
 * EXPLOITABLE — found in the first full security review of this package
 * (2026-09-20), not by any diff review, because this code never appeared in a
 * diff:
 *
 *   returnTo=/\evil.dk   →  passed the guard
 *                         →  resolves to https://evil.dk/ in a browser
 *
 * A backslash is not a path separator to RFC 3986 and IS one to the WHATWG URL
 * spec, which is what browsers implement. So the string looked like a path to
 * us and was an authority to the thing that acts on it.
 *
 * AND THE OBVIOUS FIX WAS ALSO LEAKY. Parsing once and comparing origins closes
 * the backslash and still lets `/..//evil.dk` through: `..` NORMALISES the path
 * to `//evil.dk`, which is protocol-relative when it is later used as a
 * Location. So the result is re-checked — a fixpoint — rather than trusted
 * because the input parsed cleanly.
 *
 * The rule is therefore: let the SAME parser the browser uses decide, twice.
 * A list of dangerous characters is always one trick behind; the first version
 * knew `//` and not `\`, and the second knew `\` and not `..`.
 */
function safeReturnTo(raw: string | undefined, fallback: string): string {
  if (!raw || !raw.startsWith("/")) return fallback;

  let once: URL;
  try {
    once = new URL(raw, YARDSTICK);
  } catch {
    return fallback;
  }
  if (once.origin !== YARDSTICK) return fallback;

  const normalised = once.pathname + once.search + once.hash;
  let twice: URL;
  try {
    twice = new URL(normalised, YARDSTICK);
  } catch {
    return fallback;
  }
  if (twice.origin !== YARDSTICK) return fallback;
  // Belt and braces: a normalised path must still be a path.
  if (!normalised.startsWith("/") || normalised.startsWith("//")) return fallback;

  return normalised;
}

export function ssoRoutes(options: SsoRoutesOptions = {}) {
  const config = options.config ?? loadSsoConfig();
  const client = options.client ?? createSsoClient(config);
  const loginPath = options.loginPath ?? "/auth";
  const defaultReturnTo = options.defaultReturnTo ?? "/";
  const txCookie = `${config.cookieName}_tx`;
  /**
   * The ID token, kept ONLY so logout can prove who is leaving.
   *
   * Its own cookie rather than a field on SessionPayload, for three reasons:
   * that type is public and deliberately small (session.ts says why), a JWT is
   * ~1 kB that would otherwise ride along on every single request to the app,
   * and the two are cleared at different moments.
   */
  const idTokenCookie = `${config.cookieName}_idt`;
  const backchannel = options.backchannel;
  if (backchannel && !backchannel.store) {
    throw new Error("ssoRoutes: backchannel needs a store shared by every instance of the app — there is no in-memory default.");
  }
  const onStoreError = backchannel?.onStoreError ?? "reject";

  /** A verified session, or null — also null when «Log ud overalt» has ended it. */
  async function liveSession(c: Context): Promise<SessionPayload | null> {
    const session = await verifySession(readCookie(c.req.header("cookie"), config.cookieName), config.cookieSecret);
    if (!session || !backchannel) return session;
    try {
      const before = await backchannel.store.revokedBefore(session.sub);
      if (before !== null && (session.iat ?? 0) <= before) return null;
      return session;
    } catch {
      return onStoreError === "allow" ? session : null;
    }
  }

  const app = new Hono();

  if (backchannel) {
    app.post("/backchannel-logout", async (c) => {
      c.header("Cache-Control", "no-store");
      let token: string | undefined;
      try {
        const form = await c.req.parseBody();
        token = typeof form.logout_token === "string" ? form.logout_token : undefined;
      } catch {
        token = undefined;
      }
      if (!token) return c.json({ error: "invalid_request", error_description: "logout_token is missing" }, 400);
      let verified;
      try {
        verified = await client.verifyLogoutToken(token);
      } catch (e) {
        const msg = e instanceof SsoError ? e.message : "logout_token could not be verified";
        return c.json({ error: "invalid_request", error_description: msg }, 400);
      }
      try {
        // Revoke FIRST, then record the jti. The other order loses a logout: if the
        // revoke failed after the jti was recorded, the retry would be read as a
        // replay and do nothing. Revoking twice is harmless (the store keeps the
        // latest iat), so a replay only costs one idempotent write.
        await backchannel.store.revokeSubBefore(verified.sub, verified.iat);
        await backchannel.store.useJti(verified.jti, verified.exp);
      } catch {
        // Not stored = not done. 5xx so BID reports this app as failed to the user.
        return c.json({ error: "store_unavailable" }, 503);
      }
      return c.body(null, 200);
    });
  }

  app.get("/login", async (c) => {
    const prompt = c.req.query("prompt");
    // Only the two prompts an app has a reason to ask for; anything else is dropped.
    const start = await client.beginLogin(
      prompt === "none" || prompt === "login" ? { prompt } : {},
    );
    const tx = JSON.stringify({
      state: start.state,
      codeVerifier: start.codeVerifier,
      nonce: start.nonce,
      returnTo: safeReturnTo(c.req.query("returnTo"), defaultReturnTo),
    });
    c.header(
      "Set-Cookie",
      // The signed stamp carries the SERVER's window; the cookie carries the
      // longer browser one, so an expired transaction still reaches us and can
      // be named instead of vanishing.
      cookieHeader(txCookie, await signValue(tx, config.cookieSecret, { maxAgeSeconds: TRANSACTION_MAX_AGE }), {
        maxAge: TRANSACTION_COOKIE_MAX_AGE,
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
    if (!parsed.ok) {
      /**
       * THREE CAUSES, THREE ANSWERS (components-F084.54).
       *
       * THE ORDER IN `parseTransaction` IS LOAD-BEARING AND NOT OBVIOUS:
       * `expired` is reached ONLY AFTER the signature has verified. So
       * `login_expired` is a POSITIVE CONFIRMATION that the HMAC held against
       * the CURRENT secret, and `bad_login_cookie` is the denial of that.
       *
       * WHICH MAKES THE PAIR A ONE-BIT ORACLE, and the justification that stood
       * here was wrong. It said an attacker can produce all three himself, so
       * naming them tells him nothing. That holds only for an attacker who
       * CONSTRUCTED the input and therefore knows what he is holding. The
       * interesting one has a value he FOUND — in a log, on a shared machine, in
       * a referrer leak, in a backup — and he cannot mint a
       * validly-signed-but-expired value himself. For him the answer separates
       * two things he could not otherwise learn: whether a found value is still
       * live, when the secret rotates (the same value changes code the second it
       * does), and whether two environments share a secret.
       *
       * Reported by helpdesk, 2026-09-22, measured against the published 0.3.0
       * dist rather than argued. It is NOT a hole: it does not help him forge
       * anything — one bit per attempt against an HMAC-SHA256 key he never
       * reaches. It is a property the server gives away for free.
       *
       * KEPT AS IS FOR NOW, deliberately and not by omission: the three answers
       * solve a real problem for a consumer who owns only the browser end and
       * must show "your login expired, try again" rather than "something went
       * wrong". Splitting the two audiences — all three to the app and the log,
       * one to the browser by default — is components-F084.55 and is the owner's
       * call, not a thing to change twice in an hour under a peer's argument.
       *
       * The operator half stands unchanged and is the reason the codes exist at
       * all: `bad_login_cookie` on a REAL user's browser is what a rotated
       * SSO_COOKIE_SECRET looks like from the outside.
       */
      const failures = {
        absent: {
          status: 400 as const,
          error: "no_login_in_progress",
          message: "This browser did not start a login here. Begin again from the login page.",
        },
        expired: {
          status: 400 as const,
          error: "login_expired",
          message: `This login took longer than ${TRANSACTION_MAX_AGE} seconds. Begin again from the login page.`,
        },
        unreadable: {
          status: 400 as const,
          error: "bad_login_cookie",
          message: "This browser's login cookie could not be read. Begin again from the login page.",
        },
      };
      const { status, ...body } = failures[parsed.reason];
      // Clear it either way: a transaction we refuse must not sit in the browser
      // waiting to be refused again on every retry.
      c.header("Set-Cookie", cookieHeader(txCookie, "", { maxAge: 0, secure: isSecure(c) }));
      return c.json(body, status);
    }

    const result = await client.completeLogin({
      params: new URL(c.req.url).searchParams,
      state: parsed.tx.state,
      codeVerifier: parsed.tx.codeVerifier,
      nonce: parsed.tx.nonce,
    });

    const exp = Math.floor(Date.now() / 1000) + config.sessionMaxAge;
    const session: SessionPayload = {
      sub: result.claims.sub,
      exp,
      iat: Math.floor(Date.now() / 1000),
      ...(result.claims.email ? { email: result.claims.email } : {}),
      ...(result.claims.name ? { name: result.claims.name } : {}),
      ...(result.claims.picture ? { picture: result.claims.picture } : {}),
      // Only when BID actually said so — absent means "not stated", never false.
      ...(typeof result.claims.email_verified === "boolean" ? { email_verified: result.claims.email_verified } : {}),
    };

    c.header(
      "Set-Cookie",
      cookieHeader(config.cookieName, await signSession(session, config.cookieSecret), {
        maxAge: config.sessionMaxAge,
        secure: isSecure(c),
      }),
    );
    // The logout hint. Without it the issuer MUST ask the user to confirm —
    // that is RP-initiated logout per spec, and the plugin says so itself
    // ("User confirmation is required to complete logout"). The result was an
    // unstyled English confirmation page with a bare browser button in the
    // middle of our own product.
    c.header(
      "Set-Cookie",
      cookieHeader(idTokenCookie, await signValue(result.idToken, config.cookieSecret), {
        maxAge: config.sessionMaxAge,
        secure: isSecure(c),
      }),
      { append: true },
    );
    // Clear the transaction cookie: it has done its job, and a replayed one is
    // only ever useful to someone who should not have it.
    c.header(
      "Set-Cookie",
      cookieHeader(txCookie, "", { maxAge: 0, secure: isSecure(c) }),
      { append: true },
    );
    return c.redirect(parsed.tx.returnTo, 302);
  });

  app.get("/logout", async (c) => {
    // Read the hint BEFORE clearing, obviously — but note what happens when it
    // is absent: a session minted by 0.1.0 has no such cookie, and that session
    // is still live in every app that upgrades. So a missing hint falls back to
    // the old behaviour (the issuer asks) rather than throwing. The upgrade path
    // is the one that fails in production; it gets its own test.
    const idTokenHint = await verifyValue(
      readCookie(c.req.header("cookie"), idTokenCookie),
      config.cookieSecret,
    );

    c.header(
      "Set-Cookie",
      cookieHeader(config.cookieName, "", { maxAge: 0, secure: isSecure(c) }),
    );
    c.header(
      "Set-Cookie",
      cookieHeader(idTokenCookie, "", { maxAge: 0, secure: isSecure(c) }),
      { append: true },
    );
    // F084.152 — the default: this app is logged out, BID is not, and the user
    // lands on BID's login dialog (prompt=login makes BID show it even with a
    // live BID session). Through our own /login, so PKCE and state still apply.
    if ((options.logout ?? "app") === "app") {
      return c.redirect(`${loginPath}/login?prompt=login`, 302);
    }
    // Local cookies cleared FIRST, then central logout. If the redirect to BID
    // fails or the user closes the tab, the worst case is "signed out here but
    // not everywhere" — never the reverse, which would leave this app trusting
    // a session the user believes is gone.
    return c.redirect(await client.logoutUrl(idTokenHint ? { idTokenHint } : {}), 302);
  });

  /** Reads the session and puts it on the context. Never blocks. */
  const attach: MiddlewareHandler = async (c, next) => {
    c.set(SESSION_KEY, await liveSession(c));
    await next();
  };

  /** Blocks and redirects to login, preserving where the user was going. */
  const require: MiddlewareHandler = async (c, next) => {
    const session = await liveSession(c);
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

/** Why a login transaction could not be read back. Three states, three answers. */
export type TransactionFailure = "absent" | "expired" | "unreadable";

type TransactionResult =
  | { ok: true; tx: { state: string; codeVerifier: string; nonce: string; returnTo: string } }
  | { ok: false; reason: TransactionFailure };

/**
 * Reads the login transaction back out of its signed cookie.
 *
 * RETURNS A REASON, NOT `null` (components-F084.54). It used to collapse three
 * causes into one empty answer, and /callback then told the user "you did not
 * start a login here, OR it expired" — a sentence that admits in its own wording
 * that it does not know. The word "or" was the bug.
 *
 * Age-checked against TRANSACTION_MAX_AGE, not only against the cookie's own
 * Max-Age (components-F084.53) — Max-Age is the browser's promise, and a client
 * can decline to make it. It still does NOT go through verifySession: that
 * envelope carries an `exp`, and the first version of this file used `exp: 0`,
 * which the expiry check rejected every time.
 *
 * NO FUTURE-STAMP GUARD, and that is a deliberate divergence from helpdesk's
 * implementation, which rejects a negative age so a runaway clock cannot widen
 * the window. Ours cannot be widened that way: the stamp is inside the HMAC, so
 * only OUR OWN clock could produce a future one — and refusing it would mean a
 * second app instance whose clock is a few seconds behind starts rejecting
 * perfectly good logins. That trades a theoretical gain for a real outage.
 */
async function parseTransaction(raw: string | undefined, secret: string): Promise<TransactionResult> {
  if (raw === undefined) return { ok: false, reason: "absent" };

  // Signature FIRST, without the age limit, so the two questions stay separate.
  // Asking them together is what produced one answer for three causes: a single
  // `verifyValue(..., { maxAgeSeconds })` returns null for a forged cookie and
  // for an honest late one alike.
  const signed = await verifyValue(raw, secret);
  if (signed === null) return { ok: false, reason: "unreadable" };

  const fresh = await verifyValue(raw, secret, { maxAgeSeconds: TRANSACTION_MAX_AGE });
  if (fresh === null) return { ok: false, reason: "expired" };

  try {
    const tx = JSON.parse(fresh) as {
      state: string;
      codeVerifier: string;
      nonce: string;
      returnTo: string;
    };
    // A correctly signed cookie whose contents are not a transaction is not an
    // expiry and not an absence — it is ours and it is wrong.
    if (!tx.state || !tx.codeVerifier || !tx.nonce) return { ok: false, reason: "unreadable" };
    return { ok: true, tx };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** Read the session a middleware attached. */
export function getSession(c: Context): SessionPayload | null {
  return (c.get(SESSION_KEY) as SessionPayload | null) ?? null;
}

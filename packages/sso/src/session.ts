/**
 * The app's OWN session cookie — signed, not encrypted.
 *
 * Signed is the right choice and the distinction matters: the contents are not
 * secret (a user may read their own id and name), but they must not be
 * FORGEABLE. Encryption would hide a subject id the user already knows while
 * doing nothing extra about forgery, which is the actual risk.
 *
 * What goes in is deliberately small: who you are and when this stops being
 * true. Claims that can change — a name, a role, a picture — belong in the
 * app's own store keyed by `sub`, because a cookie is a cache nobody can
 * invalidate, and a stale role in a cookie is a permission that outlives its
 * revocation.
 */

export interface SessionPayload {
  /** The subject from Broberg ID. The one stable identifier. */
  sub: string;
  /** Unix seconds. Checked on every read. */
  exp: number;
  /** Optional convenience copies; never authorisation data. */
  email?: string;
  name?: string;
  /** A URL, never bytes. The picture lives wherever BID put it; this is a
   *  reference, so a changed picture propagates without every app storing a
   *  copy that then goes stale. */
  picture?: string;
}

const enc = new TextEncoder();

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64url = (s: string) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/**
 * Sign an arbitrary string. The primitive underneath BOTH cookies this package
 * sets — the session and the short-lived login transaction.
 *
 * They are separate functions on purpose. The first version of this file had
 * the transaction ride inside the session envelope with `exp: 0`, and the
 * expiry check (`exp * 1000 <= now()`) then rejected it every single time: the
 * transaction cookie could never be read back, so every login would have failed
 * with "state does not match" — a message pointing at the wrong thing entirely.
 * Two different lifetimes wanted two different envelopes, not one envelope with
 * a sentinel in it.
 */
export async function signValue(
  value: string,
  secret: string,
  // `now` is injectable for the same reason verifySession's is: an age check
  // tested by waiting is a slow test that fails on a loaded machine.
  options: { maxAgeSeconds?: number; now?: () => number } = {},
): Promise<string> {
  const payload = b64url(enc.encode(value));
  // The timestamp goes INSIDE the signed body, never beside it. An expiry the
  // holder can edit is not a limit. `~` is outside the base64url alphabet, so
  // `t<digits>~` cannot be confused with a payload that merely starts with "t".
  const body =
    options.maxAgeSeconds === undefined
      ? payload
      : `t${Math.floor((options.now ?? Date.now)() / 1000)}~${payload}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

const STAMPED = /^t(\d+)~(.*)$/s;

/**
 * Verify the signature, and — only if you ask — the age (components-F084.53).
 *
 * THE PREFIX ON THAT NUMBER IS NOT DECORATION. F-numbers are per-project, and
 * this comment ships in the .d.ts — so a consumer reading it in their editor
 * resolves the number against whatever board THEY know. broberg-id found this
 * by reading their own F084.53, which is "no limit on password guesses": a
 * different feature, in a different repo, behind the same string.
 *
 * WITHOUT `maxAgeSeconds` this is signature-only, exactly as before. That is
 * not laziness: the login-transaction cookie has lived on its browser `Max-Age`
 * since the package shipped, and making the check mandatory would invalidate
 * every cookie already in a user's browser — an instant logout for everyone.
 *
 * WITH `maxAgeSeconds`, a value the SERVER can date is refused once it is too
 * old. Reported by broberg-id: `Max-Age` is the client's claim about when a
 * cookie stopped being valid, and a client may simply not make that claim, so
 * the server used to accept a correctly-signed transaction value forever.
 *
 * THE MIXED CASE IS THE ONE THAT DECIDES WHETHER THIS IS WORTH ANYTHING: a
 * value signed by the OLD code (no timestamp) verified by the NEW code (with a
 * limit). That happens during every rollout, and it FAILS CLOSED — otherwise an
 * undated value would be the way around the very limit being added, and the
 * limit would only apply to those not trying to avoid it.
 */
export async function verifyValue(
  token: string | undefined | null,
  secret: string,
  options: { maxAgeSeconds?: number; now?: () => number } = {},
): Promise<string | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromB64url(token.slice(dot + 1)),
      enc.encode(body),
    );
    if (!ok) return null;

    const stamped = STAMPED.exec(body);
    if (options.maxAgeSeconds !== undefined) {
      if (!stamped) return null; // undated + a limit asked for → fail CLOSED
      const issuedAt = Number(stamped[1]);
      if ((options.now ?? Date.now)() / 1000 - issuedAt > options.maxAgeSeconds) return null;
    }
    return new TextDecoder().decode(fromB64url(stamped?.[2] ?? body));
  } catch {
    return null;
  }
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  return signValue(JSON.stringify(payload), secret);
}

/**
 * Returns null for ANY reason the cookie cannot be trusted — tampered,
 * truncated, wrong secret, expired, or simply not one of ours.
 *
 * Deliberately one return value rather than distinguishing them to the caller:
 * an app that can tell "bad signature" from "expired" will eventually branch on
 * it, and there is no branch where a forged cookie should do anything other
 * than what an absent one does.
 */
export async function verifySession(
  token: string | undefined | null,
  secret: string,
  now: () => number = Date.now,
): Promise<SessionPayload | null> {
  // crypto.subtle.verify is constant-time; a hand-rolled string compare would
  // leak the signature one byte at a time.
  const body = await verifyValue(token, secret);
  if (body === null) return null;

  try {
    const payload = JSON.parse(body) as SessionPayload;
    if (typeof payload.sub !== "string" || payload.sub === "") return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Serialise a Set-Cookie value. `secure` is off only for http://localhost. */
export function cookieHeader(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean; sameSite?: "Lax" | "Strict"; path?: string },
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${opts.path ?? "/"}`,
    `Max-Age=${opts.maxAge}`,
    "HttpOnly",
    // Lax, NOT Strict, and this is load-bearing: the callback from Broberg ID
    // is a top-level GET navigation from another site. Strict withholds the
    // cookie on exactly that navigation, so the login transaction cookie would
    // be missing when it is needed and every sign-in would fail with "state
    // does not match" — a message that sends you looking in the wrong place.
    `SameSite=${opts.sameSite ?? "Lax"}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

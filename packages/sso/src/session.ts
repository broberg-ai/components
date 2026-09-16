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
export async function signValue(value: string, secret: string): Promise<string> {
  const body = b64url(enc.encode(value));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** Verify the SIGNATURE only, returning the original string. No expiry notion. */
export async function verifyValue(
  token: string | undefined | null,
  secret: string,
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
    return new TextDecoder().decode(fromB64url(body));
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

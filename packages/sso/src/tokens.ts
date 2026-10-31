/**
 * Server-side tokens for calling BrobergID on the user's behalf (F095.1).
 *
 * The login already RECEIVES an access token and a refresh token; before 0.9.0
 * ssoRoutes dropped both, so an app could not call BID's app API (the account
 * page: read and change your own name and picture) as the user.
 *
 * ── WHY NOT IN THE COOKIE ────────────────────────────────────────────────
 * The session cookie is SIGNED, not encrypted, and the browser can read it. A
 * refresh token is the longest-lived, highest-value credential in the whole
 * flow: whoever holds it can mint access tokens until it is revoked. So the
 * tokens live server-side, keyed by a random `sid` that is the only thing the
 * cookie carries. A stolen cookie still needs the server to be useful.
 */

export interface TokenSet {
  /** The BID subject the tokens belong to — lets «Log ud overalt» find them. */
  sub: string;
  accessToken: string;
  refreshToken?: string;
  /** Unix seconds. */
  expiresAt: number;
  /**
   * components-F084.163 — unix seconds of the last time BID confirmed this
   * login (the login itself, or a granted renewal). The hourly silent check
   * runs when this is an hour old. Absent on rows written before 0.24.0: those
   * are checked on their next use.
   */
  checkedAt?: number;
}

/**
 * Where the tokens live. The APP provides it in production, backed by
 * something every instance shares (SQLite on one machine, a database or Redis
 * on several) — the same reason BackchannelStore has no in-memory default.
 */
export interface TokenStore {
  get(sid: string): Promise<TokenSet | undefined>;
  set(sid: string, tokens: TokenSet): Promise<void>;
  delete(sid: string): Promise<void>;
  /** Drop every token set for `sub` — what «Log ud overalt» calls. */
  deleteSub(sub: string): Promise<void>;
}

let warned = false;

/**
 * An in-process TokenStore. Fine for tests and a single dev process. In
 * production it LOSES every user's tokens on a restart (they must log in again
 * before the account page works) and is not shared between machines — so it
 * says so, once, when created.
 */
export function memoryTokenStore(options: { quiet?: boolean } = {}): TokenStore & { readonly size: number } {
  if (!options.quiet && !warned) {
    warned = true;
    console.warn(
      "@broberg/sso: memoryTokenStore() keeps tokens in this process only — they are lost on restart and not shared " +
        "between instances. Give ssoRoutes a TokenStore backed by your database in production.",
    );
  }
  const rows = new Map<string, TokenSet>();
  return {
    get size() {
      return rows.size;
    },
    async get(sid) {
      return rows.get(sid);
    },
    async set(sid, tokens) {
      rows.set(sid, { ...tokens });
    },
    async delete(sid) {
      rows.delete(sid);
    },
    async deleteSub(sub) {
      for (const [sid, t] of rows) if (t.sub === sub) rows.delete(sid);
    },
  };
}

/** When the access token expires: `expires_in` if BID sent it, else the JWT's exp, else 5 minutes. */
export function expiresAtFrom(expiresIn: number | undefined, accessToken: string, now: number): number {
  if (typeof expiresIn === "number" && expiresIn > 0) return now + Math.floor(expiresIn);
  const parts = accessToken.split(".");
  if (parts.length === 3) {
    try {
      const json = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
      if (typeof json.exp === "number" && json.exp > now) return json.exp;
    } catch {
      /* opaque token: fall through */
    }
  }
  return now + 300;
}

/** A random session id: 128 bits, URL-safe. */
export function newSid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * components-F084.163 — the tokens are ENCRYPTED before the app's store sees
 * them. The app's store is a database row, a Redis key, a backup, a log of a
 * slow query — places a refresh token must not sit readable. AES-256-GCM, key
 * derived from SSO_COOKIE_SECRET (domain-separated, so it is never the HMAC key
 * itself). Stored as `enc:v1:<base64url(iv | ciphertext)>`.
 *
 * MIGRATION WITHOUT A LOGOUT: a row written by 0.23 or earlier is plaintext and
 * is read as it is; the next write encrypts it. A value that LOOKS encrypted but
 * does not open (the secret was rotated) reads as "no tokens" — the session then
 * behaves exactly like one that never had any, which is the honest answer.
 */
const SEALED = "enc:v1:";
const keys = new Map<string, Promise<CryptoKey>>();
function aesKey(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(`@broberg/sso token-store v1\u0000${secret}`))
      .then((raw) => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]));
    keys.set(secret, k);
  }
  return k;
}
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export async function sealToken(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(value)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return SEALED + b64url(out);
}
/** The plaintext, the legacy plaintext as-is, or null when a sealed value does not open. */
export async function openToken(value: string, secret: string): Promise<string | null> {
  if (!value.startsWith(SEALED)) return value;
  try {
    const raw = unb64url(value.slice(SEALED.length));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await aesKey(secret), raw.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
/** Wraps the app's store so every token is sealed on the way in and opened on the way out. */
export function sealedTokenStore(store: TokenStore, secret: string): TokenStore {
  return {
    async get(sid) {
      const row = await store.get(sid);
      if (!row) return undefined;
      const accessToken = await openToken(row.accessToken, secret);
      const refreshToken = row.refreshToken === undefined ? undefined : await openToken(row.refreshToken, secret);
      if (accessToken === null || refreshToken === null) return undefined;
      return { ...row, accessToken, ...(refreshToken !== undefined ? { refreshToken } : {}) };
    },
    async set(sid, tokens) {
      await store.set(sid, {
        ...tokens,
        accessToken: await sealToken(tokens.accessToken, secret),
        ...(tokens.refreshToken !== undefined ? { refreshToken: await sealToken(tokens.refreshToken, secret) } : {}),
      });
    },
    delete: (sid) => store.delete(sid),
    deleteSub: (sub) => store.deleteSub(sub),
  };
}

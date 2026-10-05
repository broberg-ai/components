/**
 * Server-side tokens for calling Broberg ID on the user's behalf (F095.1).
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

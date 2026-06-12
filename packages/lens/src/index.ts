// @broberg/lens — Lens-mint compliance core (F036).
//
// The fleet auth standard (cardmem F098.1, docs/LENS-MINT-ENDPOINT.md): the Lens
// daemon POSTs to your app's `POST /api/lens-session` with a NARROW bearer; you
// mint a SHORT-LIVED, READ-ONLY session for a DEDICATED lens principal (never
// cb@webhouse.dk) and return it as a Playwright storageState. Lens injects those
// cookies before capture, so it screenshots the REAL authed surface — incl. prod.
//
// This module is the UNIFORM + SECURE ~80% every app shares: ship-dark, a
// constant-time bearer check, a never-cb principal guard, TTL clamp, basic
// rate-limit, and the fixed storageState assembly. The app supplies only the
// auth-specific 20% — a `createLensSession(ctx)` hook that mints + SIGNS its own
// session cookie. Framework adapters live in `./next` and `./hono`.

import { createHash, timingSafeEqual } from "node:crypto";

/** Default + max session TTL: 10 minutes — long enough for a capture run. */
const DEFAULT_TTL_MS = 10 * 60 * 1000;
/** Floor so a misconfigured app can't mint an instantly-dead session. */
const MIN_TTL_MS = 60 * 1000;
const DEFAULT_MAX_PER_MINUTE = 30;

/** The permanent human admin — the lens principal must NEVER be this. */
const FORBIDDEN_PRINCIPAL = "cb@webhouse.dk";

/**
 * A single cookie the app's `createLensSession` hook returns. Only `name` +
 * `value` are required; the core fills the rest (`domain`, `path`, `secure`,
 * `expires`, …) from the request + options.
 */
export interface LensCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  /** unix SECONDS. Omit to let the core stamp it from the clamped TTL. */
  expires?: number;
}

/** What the app's `createLensSession` hook receives. */
export interface LensSessionContext {
  /** The dedicated read-only lens principal (e.g. "lens@myapp.local"). */
  principal: string;
  /** Request host — the default cookie domain. */
  host: string;
  /** Whether the request arrived over https — the default cookie `secure`. */
  secure: boolean;
  /** The clamped TTL, in ms. */
  ttlMs: number;
  /** When the session must expire (unix MS). Clamp your session row to this. */
  expiresAt: number;
}

/** The app-supplied session minter — the auth-specific 20%. */
export type CreateLensSession = (
  ctx: LensSessionContext,
) => Promise<LensCookie | LensCookie[]> | LensCookie | LensCookie[];

export interface LensMintOptions {
  /**
   * The narrow bearer secret. Defaults to `process.env.LENS_MINT_SECRET`, read
   * per-request so the endpoint ships dark and flips on without a restart.
   */
  secret?: string;
  /** App-supplied session minter (mints + signs the principal's cookie). */
  createSession: CreateLensSession;
  /** The dedicated read-only lens identity. Required; never cb@webhouse.dk. */
  principal: string;
  /** Session TTL in ms. Default 600_000; clamped to [60_000, 600_000]. */
  ttlMs?: number;
  /**
   * Force a cookie domain (e.g. ".myapp.com" for cross-subdomain capture). Else
   * `process.env.LENS_COOKIE_DOMAIN`, else the request host. NEVER derive it
   * from the bound socket address — on Fly/proxy hosts that is "0.0.0.0", and
   * the browser then never sends the cookie (silent false-green).
   */
  cookieDomain?: string;
  /** Basic per-handler fixed-window rate-limit. Default 30/min; 0 disables. */
  maxPerMinute?: number;
}

/** A normalized request — what the framework adapters extract + pass in. */
export interface LensMintRequest {
  authorization: string | null;
  host: string;
  secure: boolean;
}

/** The fixed Playwright storageState the Lens daemon consumes verbatim. */
export interface LensStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax" | "Strict" | "None";
    expires: number;
  }>;
  origins: never[];
}

export interface LensMintResponse {
  status: number;
  body: LensStorageState | { error: string };
}

/** Length-independent constant-time compare (hash → equal-length → compare). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function parseBearer(authorization: string | null): string | null {
  if (!authorization) return null;
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

function clampTtl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs)) return DEFAULT_TTL_MS;
  return Math.min(Math.max(ttlMs, MIN_TTL_MS), DEFAULT_TTL_MS);
}

/** localhost-family hosts a cookie must never be scoped to on a real (https) host. */
const NON_PUBLIC_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

/** Strip a trailing `:port` — cookie domains are never port-scoped (`localhost:3000` → `localhost`). */
function hostToDomain(host: string): string {
  return host.replace(/:\d+$/, "");
}

/**
 * Build the normalized Lens-mint handler. Wrap it with `@broberg/lens/next` or
 * `@broberg/lens/hono`, or call the returned function directly with a
 * `{ authorization, host, secure }` request from any framework.
 *
 * Throws at construction if `principal` is missing/blank or is cb@webhouse.dk.
 */
export function createLensMintHandler(
  opts: LensMintOptions,
): (req: LensMintRequest) => Promise<LensMintResponse> {
  const principal = (opts.principal ?? "").trim();
  if (!principal) {
    throw new Error(
      '@broberg/lens: `principal` is required — the dedicated read-only lens identity (e.g. "lens@yourapp.local").',
    );
  }
  if (principal.toLowerCase() === FORBIDDEN_PRINCIPAL) {
    throw new Error(
      `@broberg/lens: refusing ${FORBIDDEN_PRINCIPAL} as the lens principal — it must be a dedicated read-only identity, never the human admin.`,
    );
  }

  const maxPerMinute = opts.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE;
  let windowStart = Date.now();
  let count = 0;
  function withinRate(): boolean {
    if (maxPerMinute <= 0) return true;
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= maxPerMinute;
  }

  return async function handle(req: LensMintRequest): Promise<LensMintResponse> {
    // Ship-dark: inert until the secret is provisioned. Read per-request.
    const secret = opts.secret ?? process.env.LENS_MINT_SECRET;
    if (!secret) {
      return { status: 503, body: { error: "lens-session disabled (LENS_MINT_SECRET unset)" } };
    }

    const provided = parseBearer(req.authorization);
    if (!provided || !safeEqual(provided, secret)) {
      return { status: 401, body: { error: "unauthorized" } };
    }

    // Rate-limit only authenticated requests — the only holder of a valid bearer
    // is the daemon, so this caps the mint rate if the secret ever leaks.
    if (!withinRate()) {
      return { status: 429, body: { error: "rate limited" } };
    }

    const ttlMs = clampTtl(opts.ttlMs ?? DEFAULT_TTL_MS);
    const expiresAt = Date.now() + ttlMs;
    const ctx: LensSessionContext = {
      principal,
      host: req.host,
      secure: req.secure,
      ttlMs,
      expiresAt,
    };

    // The app-supplied minter can fail (DB down, signing error, …). Keep the
    // {status, body} contract intact: a 500 JSON instead of an uncaught throw
    // bubbling up as a framework 500 with a stack. Log server-side for debugging;
    // never leak the underlying error to the caller (the daemon).
    let minted: LensCookie | LensCookie[];
    try {
      minted = await opts.createSession(ctx);
    } catch (err) {
      console.error("[@broberg/lens] createSession threw while minting a lens session:", err);
      return { status: 500, body: { error: "lens-session mint failed" } };
    }

    const cookies = Array.isArray(minted) ? minted : [minted];
    const explicitDomain = opts.cookieDomain ?? process.env.LENS_COOKIE_DOMAIN;
    // Derive the cookie domain from the request host with the port stripped — a
    // localhost dev server is hit at `localhost:3000`, and `localhost:3000` is an
    // invalid cookie domain. (In prod this never bit: prod hosts carry no port.)
    const fallbackDomain = explicitDomain ?? hostToDomain(req.host);
    const expiresSec = Math.floor(expiresAt / 1000);

    // Loud-warn the silent false-green: on an https request whose cookie domain
    // resolved (with NO explicit override) to a localhost-family host, the browser
    // will never send the cookie to the real prod host — behind a reverse proxy the
    // Host header can be "localhost"/"0.0.0.0" (fds hit exactly this). Genuine http
    // localhost dev stays silent (req.secure === false there).
    if (!explicitDomain && req.secure && NON_PUBLIC_HOSTS.has(fallbackDomain.toLowerCase())) {
      console.warn(
        `[@broberg/lens] cookie domain resolved to "${fallbackDomain}" on an https request — ` +
          "behind a reverse proxy the browser will NOT send this cookie to your real host " +
          "(a silent false-green). Set LENS_COOKIE_DOMAIN to your public prod host.",
      );
    }

    const storageState: LensStorageState = {
      cookies: cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain ?? fallbackDomain,
        path: c.path ?? "/",
        httpOnly: c.httpOnly ?? true,
        secure: c.secure ?? req.secure,
        sameSite: c.sameSite ?? "Lax",
        expires: c.expires ?? expiresSec,
      })),
      origins: [],
    };

    return { status: 200, body: storageState };
  };
}

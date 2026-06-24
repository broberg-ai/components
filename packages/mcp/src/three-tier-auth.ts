import type { Principal, ToolContext } from "./types";
import { parseBearer } from "./auth";

type MaybePromise<T> = T | Promise<T>;

/**
 * The hashed 3-tier auth cascade (cardmem's prod model), as host-supplied
 * callbacks so the toolkit stays schema-decoupled: an inbound request is tried
 * against API key → session → local bootstrap, first hit wins. Every tier
 * returns a {@link Principal} (or `null` to fall through); the toolkit owns only
 * the ordering + the bearer extraction. Recommended tier-1 hashing/lookup:
 * `@broberg/apikey` `hashKey` inside the `apiKey` callback (NOT a hard dep here).
 */
export interface ThreeTierAuthConfig<Req = unknown> {
  /**
   * Tier 1 — hashed API key. Receives the raw bearer token (e.g. `pa_<hex>`);
   * the host hashes + looks it up and returns a Principal, or `null` to fall
   * through to the next tier.
   */
  apiKey?: (token: string, req: Req) => MaybePromise<Principal | null>;
  /** Tier 2 — session / cookie (e.g. Better-Auth). Returns a Principal or `null`. */
  session?: (req: Req) => MaybePromise<Principal | null>;
  /**
   * Tier 3 — local bootstrap (same-host / dev). Returns a Principal or `null`.
   * Off by default; wire it only where a trusted local caller is expected.
   */
  bootstrap?: (req: Req) => MaybePromise<Principal | null>;
  /**
   * Restrict tier 1 to tokens carrying this prefix (e.g. `"pa_"`). A bearer
   * without the prefix skips the apiKey tier. Omit to try every bearer.
   */
  apiKeyPrefix?: string;
  /** Read the `Authorization` header. Default handles Web `Request` + Node `IncomingMessage`. */
  getAuthHeader?: (req: Req) => string | null | undefined;
  /** Called when every tier misses. Default throws `Error("unauthorized")` (→ 401 at the HTTP boundary). */
  onUnauthorized?: (req: Req) => never;
}

/**
 * Build an `authenticate(req)` resolver from a 3-tier config. It returns a full
 * {@link ToolContext} so it drops straight into `createHttpMcpHandler`,
 * `createSseMcpHandler`, or `createWebSseMcpHandler` `authenticate`. `ctxFor`
 * optionally derives the host-injected `ctx` (db/services) from the principal.
 */
export function resolve3TierAuth<Req = unknown, Ctx = unknown>(
  config: ThreeTierAuthConfig<Req>,
  ctxFor?: (principal: Principal, req: Req) => MaybePromise<Ctx>,
): (req: Req) => Promise<ToolContext<Ctx>> {
  const getAuthHeader = config.getAuthHeader ?? defaultGetAuthHeader;

  return async (req: Req): Promise<ToolContext<Ctx>> => {
    const principal = await cascade(config, req, getAuthHeader);
    if (!principal) {
      if (config.onUnauthorized) return config.onUnauthorized(req);
      throw new Error("unauthorized");
    }
    const ctx = ctxFor ? await ctxFor(principal, req) : (undefined as Ctx);
    return { principal, ctx };
  };
}

async function cascade<Req>(
  config: ThreeTierAuthConfig<Req>,
  req: Req,
  getAuthHeader: (req: Req) => string | null | undefined,
): Promise<Principal | null> {
  // Tier 1 — API key
  if (config.apiKey) {
    const token = parseBearer(getAuthHeader(req));
    if (token && (!config.apiKeyPrefix || token.startsWith(config.apiKeyPrefix))) {
      const p = await config.apiKey(token, req);
      if (p) return stamp(p, false);
    }
  }
  // Tier 2 — session / cookie
  if (config.session) {
    const p = await config.session(req);
    if (p) return stamp(p, true);
  }
  // Tier 3 — local bootstrap
  if (config.bootstrap) {
    const p = await config.bootstrap(req);
    if (p) return stamp(p, false);
  }
  return null;
}

/** Default `viaSession` per tier only when the callback left it unset. */
function stamp(p: Principal, viaSession: boolean): Principal {
  return p.viaSession === undefined ? { ...p, viaSession } : p;
}

/** Read `Authorization` from a Web `Request` (Headers.get) or a Node-style headers bag. */
function defaultGetAuthHeader(req: unknown): string | null {
  const h = (req as { headers?: unknown } | null | undefined)?.headers;
  if (!h) return null;
  if (typeof (h as Headers).get === "function") return (h as Headers).get("authorization");
  const rec = h as Record<string, string | string[] | undefined>;
  const v = rec.authorization ?? rec.Authorization;
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

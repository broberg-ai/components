// @broberg/lens/next-auth — a ready-made `createSession` hook for NextAuth (v5)
// apps (F051).
//
// Every NextAuth-behind-login repo that wants Cardmem Lens to screenshot its
// AUTHED pages must mint a short-lived NextAuth session cookie and hand Lens a
// Playwright storageState. The `@broberg/lens` core already owns the uniform 80%
// (`createLensMintHandler`); the NextAuth JWT-encode is the app-specific 20% that
// every NextAuth app otherwise re-derives — including three subtle cookie gotchas.
// This module captures them ONCE.
//
// `next-auth` is an OPTIONAL peer dep: it is imported LAZILY (only when the
// default encoder runs), and the encoder is injectable — so the `@broberg/lens`
// core stays dependency-free and a non-NextAuth consumer is unaffected.

import type { LensCookie, LensSessionContext } from "./index";

/** The subset of `next-auth/jwt`'s `encode` this helper depends on (v5 shape). */
export type NextAuthEncode = (params: {
  token: Record<string, unknown>;
  secret: string;
  /** GOTCHA: NextAuth derives the JWE key with salt = the cookie name. */
  salt: string;
  /** JWT lifetime in SECONDS. */
  maxAge: number;
}) => Promise<string>;

export interface NextAuthLensOptions {
  /** The NextAuth `AUTH_SECRET` (the JWE encryption key). Required. */
  authSecret: string;
  /**
   * Claims for the lens principal's JWT (e.g. `{ id, email, name }`). `sub`
   * defaults to `claims.sub ?? claims.id ?? claims.email ?? ctx.principal`.
   */
  claims: Record<string, unknown>;
  /**
   * NextAuth v5 secure-cookie mode. Drives the cookie NAME (`__Secure-` prefix),
   * the salt (== cookie name) AND the cookie's `secure` flag — the three must
   * agree. Default: `process.env.NODE_ENV === "production"` (NextAuth v5's
   * `useSecureCookies` default).
   */
  secure?: boolean;
  /**
   * Override the session cookie name. Default: `__Secure-authjs.session-token`
   * in secure mode, else `authjs.session-token`.
   */
  cookieName?: string;
  /** JWT `maxAge` in seconds. Default: the core's clamped TTL (`ctx.ttlMs / 1000`). */
  maxAgeSec?: number;
  /**
   * Override the JWT encoder (for tests, or a non-default NextAuth build).
   * Default: the real `encode` from `next-auth/jwt`, imported lazily.
   */
  encode?: NextAuthEncode;
}

/** The default NextAuth v5 session cookie name for a given secure mode. */
export function nextAuthCookieName(secure: boolean): string {
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

/** Lazily import `next-auth/jwt`'s `encode` so `next-auth` stays an optional peer. */
async function lazyEncode(params: Parameters<NextAuthEncode>[0]): Promise<string> {
  let mod: { encode: NextAuthEncode };
  try {
    // Indirect the specifier through a `string`-typed var so tsc does not try to
    // statically resolve the optional `next-auth` peer at build time.
    const spec: string = "next-auth/jwt";
    mod = (await import(spec)) as { encode: NextAuthEncode };
  } catch {
    throw new Error(
      "@broberg/lens/next-auth: `next-auth` is not installed. Install it (it is an " +
        "optional peer dependency) or pass a custom `encode` to nextAuthLensSession().",
    );
  }
  return mod.encode(params);
}

/**
 * Build a `@broberg/lens` `createSession` hook for a NextAuth (v5) app. Wire it
 * into `createLensMintHandler({ createSession: nextAuthLensSession({...}) })`.
 *
 * Captures the battle-tested Cardmem-Lens NextAuth gotchas ONCE:
 *  1. `salt` passed to `encode` MUST equal the cookie name — NextAuth `getToken`
 *     derives the key with `salt = cookie name`; a mismatch decodes to `null`.
 *  2. a `__Secure-`-prefixed cookie is rejected by the browser without
 *     `secure: true` — secure mode drives the cookie name AND the secure flag.
 *  3. Chromium rejects a secure cookie set by `{domain}` alone; the Cardmem Lens
 *     daemon synthesizes an https source-URL so `{domain, path}` works. (On a
 *     non-daemon env, set a `url` cookie instead — outside this helper's scope.)
 *
 * The `@broberg/lens` core fills domain/path/expires from the request.
 */
export function nextAuthLensSession(
  opts: NextAuthLensOptions,
): (ctx: LensSessionContext) => Promise<LensCookie> {
  const encode = opts.encode ?? lazyEncode;
  return async (ctx): Promise<LensCookie> => {
    const secure = opts.secure ?? process.env.NODE_ENV === "production";
    const cookieName = opts.cookieName ?? nextAuthCookieName(secure);
    const maxAge = opts.maxAgeSec ?? Math.floor(ctx.ttlMs / 1000);
    const sub = opts.claims.sub ?? opts.claims.id ?? opts.claims.email ?? ctx.principal;
    const value = await encode({
      token: { ...opts.claims, sub },
      secret: opts.authSecret,
      salt: cookieName, // GOTCHA #1: salt MUST equal the cookie name.
      maxAge,
    });
    // GOTCHA #2: a __Secure- cookie is invalid without secure:true.
    const isSecure = secure || cookieName.startsWith("__Secure-");
    return { name: cookieName, value, secure: isSecure, httpOnly: true, sameSite: "Lax" };
  };
}

import { timingSafeEqual } from "node:crypto";

export interface ApiKeyConfig {
  /** The secret bearer token value to match. */
  key: string;
  /** A human label surfaced in audit/logging. */
  label?: string;
  /** Scopes this key grants. */
  scopes?: string[];
}

export type AuthResult =
  | { authenticated: true; label?: string; scopes: string[] }
  | { authenticated: false; error: string };

/**
 * Parse a `Bearer <token>` header and timing-safely match it against the
 * configured keys. The length-check precedes `timingSafeEqual` (which throws on
 * unequal lengths) — the cms-mcp-server seed pattern, extracted 1:1.
 */
export function validateBearerKey(
  authHeader: string | null | undefined,
  keys: ApiKeyConfig[],
): AuthResult {
  if (!authHeader) return { authenticated: false, error: "missing Authorization header" };
  const token = bearerToken(authHeader);
  if (token === null) return { authenticated: false, error: "malformed Authorization header" };

  const presented = Buffer.from(token);
  for (const k of keys) {
    const expected = Buffer.from(k.key);
    if (expected.length === presented.length && timingSafeEqual(expected, presented)) {
      return { authenticated: true, label: k.label, scopes: k.scopes ?? [] };
    }
  }
  return { authenticated: false, error: "invalid key" };
}

/** AND semantics: every required scope must be held. */
export function hasScope(userScopes: string[], required: string[]): boolean {
  return required.every((r) => userScopes.includes(r));
}

/** Extract the token from a `Bearer <token>` header, or null if absent/malformed. */
export function parseBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  return bearerToken(authHeader);
}

/** The token of a `Bearer <token>` header, or null. One linear pass: the /^Bearer\s+(.+)$/i it
 *  replaces overlaps `\s+` with `.+` and is polynomial on a long run of spaces (CodeQL
 *  js/polynomial-redos); same answer — the scheme is case-insensitive, at least one whitespace
 *  follows it, and the token is the rest with no line break in it. */
function bearerToken(header: string): string | null {
  const t = header.trim();
  if (t.length < 8 || t.slice(0, 6).toLowerCase() !== "bearer" || !/\s/.test(t[6]!)) return null;
  const token = t.slice(6).trimStart();
  return token !== "" && !/[\n\r\u2028\u2029]/.test(token) ? token : null;
}

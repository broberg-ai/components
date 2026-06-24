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
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return { authenticated: false, error: "malformed Authorization header" };

  const presented = Buffer.from(match[1]);
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
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1] : null;
}

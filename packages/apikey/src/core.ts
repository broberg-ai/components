import { createHash, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

/**
 * Core API-key crypto primitives. No framework, no storage — the package owns
 * the dangerous-to-get-wrong bits (constant-time compare, prefixed minting),
 * the consumer owns where the key lives.
 */

/** Mint a prefixed key: `${prefix}_${hex}`. `bytes` defaults to 32 (256-bit). */
export function generateKey(prefix: string, bytes = 32): string {
  if (!prefix) throw new Error("generateKey: prefix is required");
  if (bytes < 16) throw new Error("generateKey: bytes must be >= 16");
  return `${prefix}_${randomBytes(bytes).toString("hex")}`;
}

/** sha256 hex of the raw key — what you store when you hash-at-rest. */
export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Length-checked constant-time string compare. Returns false (never throws) on a
 * length mismatch — this is the primitive that replaces the unsafe `a !== b`
 * comparisons found across the fleet (e.g. pitch). Length is not itself secret.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return nodeTimingSafeEqual(ab, bb);
}

/**
 * Verify a presented key against a stored value, constant-time.
 * - `hashed` (default true): compares sha256(presented) against the stored hash
 *   (trail / cardmem / cms / vn — hash-at-rest).
 * - `hashed: false`: compares the raw strings (upmetrics — plaintext-revealable).
 */
export function verifyKey(presented: string, stored: string, opts?: { hashed?: boolean }): boolean {
  const hashed = opts?.hashed ?? true;
  return hashed ? timingSafeEqual(hashKey(presented), stored) : timingSafeEqual(presented, stored);
}

/** First `length` chars of the raw key — the display/grep anchor shown alongside a key. */
export function makeKeyPreview(raw: string, length = 14): string {
  return raw.slice(0, length);
}

/**
 * Simple scope check. A granted scope satisfies a required one when it is exact,
 * `*` (all), or `area:*` (all actions in an area). Returns true when nothing is
 * required. For the richer permission × resource × CIDR × TTL cascade use
 * `evaluateToken` from `@broberg/apikey/authorize`.
 */
export function hasScope(granted: string[], required: string[]): boolean {
  if (required.length === 0) return true;
  return required.every((req) => granted.some((g) => scopeMatches(g, req)));
}

function scopeMatches(granted: string, required: string): boolean {
  if (granted === "*" || granted === required) return true;
  const [gArea, gAction] = granted.split(":");
  const [rArea] = required.split(":");
  return gAction === "*" && gArea === rArea && rArea !== undefined;
}

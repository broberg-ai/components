/**
 * The object-key guard — ONE definition, used by EVERY provider.
 *
 * ── WHY IT LIVES HERE AND NOT IN A PROVIDER ───────────────────────────────
 *
 * It used to live inside `volume.ts`, and `r2.ts` had nothing. The two
 * providers therefore disagreed about the same key, and the disagreement was
 * INVISIBLE until the day a consumer switched provider — which is exactly what
 * this package promises is a config change. broberg-id hit it moving BID's
 * avatars from `volume` to `r2` (components-F086).
 *
 * The rule is not "fix r2 too". It is "there must be only one rule to fix".
 * @broberg/mail-identity (F070) is the precedent: two codebases wrote the same
 * security rule independently and BOTH had holes in it. A second correct copy
 * is still a second copy.
 *
 * ── WHAT THE OBVIOUS IMPLEMENTATION MISSES ────────────────────────────────
 *
 * `encodeURIComponent` does NOT encode a dot. Measured:
 *
 *     encodeURIComponent("..") === ".."
 *
 * So percent-encoding each segment — which looks like it sanitises the key —
 * lets `..` through untouched. It then lands in a URL, and the URL parser
 * collapses it exactly as a browser would:
 *
 *     .../bucket/tenant-a/../tenant-b/x.jpg   →   .../bucket/tenant-b/x.jpg
 *
 * That second case is the dangerous one and it is not the one you notice
 * first. Escaping the BUCKET can still be refused by a bucket-scoped token —
 * there is a layer below us that may say no. Escaping only the keyPrefix stays
 * inside the bucket the token is allowed to touch, so NOTHING refuses it. And
 * keyPrefix is what this package offers as tenant isolation.
 */

/** Thrown for a key that would escape its root or its prefix. */
export function assertSafeKey(key: string, provider: string): string[] {
  const normalized = key.replace(/^\/+/, "");
  if (normalized === "") throw new Error(`media(${provider}): key is empty`);
  if (normalized.includes("\0")) throw new Error(`media(${provider}): key contains a NUL byte`);
  if (normalized.includes("\\")) throw new Error(`media(${provider}): key contains a backslash: ${key}`);
  const segments = normalized.split("/");
  for (const segment of segments) {
    // "" catches a double slash, which collapses the same way "." does.
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`media(${provider}): key escapes the root: ${key}`);
    }
  }
  return segments;
}

/** The same check, returning the normalised key rather than its segments. */
export function safeKey(key: string, provider: string): string {
  return assertSafeKey(key, provider).join("/");
}

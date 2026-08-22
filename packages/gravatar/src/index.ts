export type GravatarDefault =
  | "404"
  | "mp"
  | "identicon"
  | "monsterid"
  | "wavatar"
  | "retro"
  | "robohash"
  | "blank";

export interface GravatarUrlOptions {
  size?: number;
  default?: GravatarDefault;
  cacheBust?: boolean;
}

/** SHA-256 hex of the normalised email (lowercase + trim). */
export async function gravatarHash(email: string): Promise<string> {
  const normalised = email.trim().toLowerCase();
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalised),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Gravatar URL for an email. Default `d=404` so a missing avatar returns 404
 *  instead of a placeholder — consumers use this to detect the 404 and fall
 *  back to initials. Cache-bust is opt-in only. */
export async function gravatarUrl(
  email: string,
  opts: GravatarUrlOptions = {},
): Promise<string> {
  const { size = 80, default: d = "404", cacheBust = false } = opts;
  const hash = await gravatarHash(email);
  const params = new URLSearchParams({ d, s: String(size) });
  if (cacheBust) params.set("v", String(Math.floor(Date.now() / (1000 * 60 * 60))));
  return `https://www.gravatar.com/avatar/${hash}?${params}`;
}

/** Returns true when Gravatar has a picture for this email. Uses a HEAD
 *  request with d=404; returns false on network error. */
/** Three outcomes, because there are three. */
export type GravatarPresence = "yes" | "no" | "unknown";

/**
 * Does this address have a Gravatar?
 *
 * F013.7 — filed by moovyy the day they adopted this package. The old
 * boolean collapsed three facts into two: a 503 from Automattic and a dropped
 * connection both came back `false`, which reads as "there is no picture".
 *
 * And you CACHE that answer — you have to, or you ask Automattic on every page
 * render. So a ten-second hiccup cost a user their avatar until the cache
 * expired, with nothing at the call-site able to tell. A missing value
 * degrading silently into a confident answer.
 *
 *   404                                   → "no"       genuinely no avatar
 *   200                                   → "yes"
 *   5xx · a throw · a timeout · anything  → "unknown"  DO NOT cache this as a no
 */
export async function gravatarLookup(email: string, size = 80): Promise<GravatarPresence> {
  let res: Response;
  try {
    const url = await gravatarUrl(email, { size, default: "404" });
    res = await fetch(url, { method: "HEAD" });
  } catch {
    // Network, DNS, abort — we never got an answer, so we do not have one.
    return "unknown";
  }
  if (res.status === 404) return "no";
  if (res.ok) return "yes";
  // 5xx, 429, or anything unexpected: Gravatar did not tell us about this user.
  return "unknown";
}

/**
 * @deprecated for anything you cache — prefer {@link gravatarLookup}.
 *
 * Kept unchanged for existing callers, and honest about what it costs: this
 * CANNOT distinguish "no avatar" from "we could not ask". Both are `false`.
 * If you store this result, you are storing a guess on every failure.
 */
export async function gravatarExists(email: string, size = 80): Promise<boolean> {
  return (await gravatarLookup(email, size)) === "yes";
}

/** Generate display initials from a name or email (max 2 uppercase chars).
 *  - Two-word name → first letter of first + last word.
 *  - Single word → first two chars.
 *  - No name → first two chars of the email prefix.
 *  - Both null/empty → '??'. */
export function getInitials(
  name?: string | null,
  email?: string | null,
): string {
  // F013.7 — split on anything that is not a letter or a digit, not on
  // whitespace. "Lens (verifikation)" used to render as "L(" in a real avatar
  // circle: the code took the first CHARACTER of each part without asking
  // whether it was a letter. Unicode-aware on purpose — a class that quietly
  // excluded CJK or accented Latin would pass every ASCII test and break real
  // users, so 李 明 and José are asserted cases, not afterthoughts.
  const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  const nameWords = name ? words(name) : [];
  if (nameWords.length >= 2) {
    return (nameWords[0][0] + nameWords[nameWords.length - 1][0]).toUpperCase();
  }
  if (nameWords.length === 1) {
    return nameWords[0].substring(0, 2).toUpperCase();
  }

  // The email branch now does what its doc comment always claimed: the PREFIX.
  // It used to read substring(0,2) of the WHOLE address, so x@webhouse.dk gave
  // "X@". It only ever looked right because most addresses start with two
  // letters — cb@webhouse.dk → "CB" was luck, not design.
  const emailWords = email ? words(email.split("@")[0]) : [];
  if (emailWords.length >= 2) {
    return (emailWords[0][0] + emailWords[emailWords.length - 1][0]).toUpperCase();
  }
  if (emailWords.length === 1) {
    return emailWords[0].substring(0, 2).toUpperCase();
  }

  // Reachable at last. A whitespace-only name used to return two SPACES — the
  // string is truthy, so this fallback was never consulted, and the avatar
  // circle rendered blank with nothing reporting a problem.
  return "??";
}

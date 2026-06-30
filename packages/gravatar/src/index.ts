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
export async function gravatarExists(email: string, size = 80): Promise<boolean> {
  try {
    const url = await gravatarUrl(email, { size, default: "404" });
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
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
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }
  if (email) {
    return email.substring(0, 2).toUpperCase();
  }
  return "??";
}

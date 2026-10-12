// F099.2 — the fingerprint engine every clipper shares (Trail Web Clipper, Jam
// Clipper). Pure TypeScript, no browser API beyond Web Crypto (present in every
// extension context and in Node ≥ 19).
//
// The model:
//  - A clip is an ordered list of UNITS (one for a plain page, one per turn for
//    a chat).
//  - Each unit has a fingerprint over (kind, role, position, content).
//  - Each unit also has a CHAIN fingerprint over (previous chain fp, its own fp),
//    so a change anywhere earlier changes every later chain fp — the chain is
//    the conversation's history, not a bag of turns.
//  - A destination remembers the chain fps it has already received. Comparing
//    those with the current chain gives one of three answers: nothing new,
//    append these, or BRANCH here (an earlier unit changed: an edited prompt, a
//    regenerated answer). A branch never overwrites the old line; the old chain
//    fps stay valid and the new ones start from the last shared link.
//  - The idempotency key for sending a unit is its chain fp, so resending the
//    same snapshot can never create a duplicate.

export interface Unit {
  /** "page" for a whole page, "turn" for a chat turn, or a consumer's own kind. */
  kind: string;
  /** For chat turns: "user" | "assistant" | … */
  role?: string;
  /** The unit's content, normally markdown. */
  content: string;
  /** 0-based place in the clip. */
  position: number;
}

export interface Link {
  position: number;
  /** sha256 over (kind, role, position, content). */
  fp: string;
  /** sha256 over (previous chainFp, fp) — "root" before the first unit. */
  chainFp: string;
}

export type Diff<U extends Unit = Unit> =
  /** The destination already has exactly this chain. */
  | { kind: "same" }
  /** New units after everything the destination has; send them in order. */
  | { kind: "append"; from: number; units: U[]; links: Link[] }
  /**
   * An earlier unit changed. Everything from `forkAt` on is a new branch whose
   * parent is `parentChainFp` (the last link both lines share, or "root"). The
   * destination keeps its old line; nothing is overwritten.
   */
  | { kind: "branch"; forkAt: number; parentChainFp: string; units: U[]; links: Link[] };

export const ROOT = "root";

const enc = new TextEncoder();
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The fingerprint of one unit. JSON keeps fields from bleeding into each other. */
export function unitFingerprint(u: Unit): Promise<string> {
  return sha256(JSON.stringify([u.kind, u.role ?? "", u.position, u.content]));
}

/** Fingerprint and chain a whole clip, in order. Positions must be 0..n-1. */
export async function chain(units: readonly Unit[]): Promise<Link[]> {
  const links: Link[] = [];
  let prev = ROOT;
  for (const [i, u] of units.entries()) {
    if (u.position !== i) throw new Error(`web-clipper: unit at index ${i} has position ${u.position} — positions must be 0..n-1 in order`);
    const fp = await unitFingerprint(u);
    prev = await sha256(`${prev}:${fp}`);
    links.push({ position: i, fp, chainFp: prev });
  }
  return links;
}

/**
 * What to send, given the chain fps the destination already has for this
 * anchor (in order, as returned when they were sent). Pass [] for a new clip.
 */
export async function diff<U extends Unit>(known: readonly string[], units: readonly U[]): Promise<Diff<U>> {
  const links = await chain(units);
  let shared = 0;
  while (shared < known.length && shared < links.length && known[shared] === links[shared]!.chainFp) shared++;
  if (shared === known.length) {
    if (shared === links.length) return { kind: "same" };
    return { kind: "append", from: shared, units: units.slice(shared), links: links.slice(shared) };
  }
  // The destination has a link the current clip does not: an earlier unit changed
  // (or the clip got shorter). A shorter clip with nothing new is still "same" —
  // a page can lose content without anyone having anything to send.
  if (shared === links.length) return { kind: "same" };
  return {
    kind: "branch",
    forkAt: shared,
    parentChainFp: shared === 0 ? ROOT : links[shared - 1]!.chainFp,
    units: units.slice(shared),
    links: links.slice(shared),
  };
}

/** The idempotency key for sending one unit: its chain fp. */
export function idempotencyKey(link: Link): string {
  return link.chainFp;
}

/**
 * Check a stored chain against its units. Returns the first position whose
 * fingerprint or chain fingerprint does not match, or null when it is intact.
 */
export async function verify(units: readonly Unit[], links: readonly Link[]): Promise<{ position: number; reason: "length" | "fp" | "chain" } | null> {
  if (units.length !== links.length) return { position: Math.min(units.length, links.length), reason: "length" };
  let prev = ROOT;
  for (const [i, u] of units.entries()) {
    const fp = await unitFingerprint(u);
    if (fp !== links[i]!.fp) return { position: i, reason: "fp" };
    prev = await sha256(`${prev}:${fp}`);
    if (prev !== links[i]!.chainFp) return { position: i, reason: "chain" };
  }
  return null;
}

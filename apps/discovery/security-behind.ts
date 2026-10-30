// F039.9 — "you are behind on a release that fixed a security defect" as its own
// signal, instead of a version string a session must compare by hand.
//
// The marks are set by the package OWNER in the roster (`sec` on a row), never
// derived from commit text: a heuristic mislabels in both directions, and a wrong
// "not security-relevant" is worse than no flag at all.
//
// SILENCE IS NOT CLEARANCE. A package with no marks produces nothing here — and
// nothing anywhere claims it is free of security issues. The roster cannot know
// what it was never told (F039.7).

/** One security-relevant release: versions below `v` (and, if given, at or above `since`) have the defect. */
export interface SecMark {
  v: string;
  /** One line: what the OLDER version gets wrong. */
  why: string;
  /** First affected version, when the defect was introduced later than 0.0.0. */
  since?: string;
}

export interface SecurityBehind {
  pkg: string;
  have: string;
  move_to: string;
  fixes: { v: string; why: string }[];
}

function parse(v: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/**
 * Which of a session's adopted packages sit below a security-marked release.
 * Returns [] when the session is current on every marked package — and the
 * caller must then say NOTHING, so the line's presence carries information.
 * An unparseable version is skipped rather than guessed at.
 */
export function securityBehind(
  enrolled: ReadonlyArray<{ pkg: string; version: string }>,
  rows: ReadonlyArray<{ pkg?: string; ver?: string; sec?: SecMark[] }>,
): SecurityBehind[] {
  const out: SecurityBehind[] = [];
  for (const e of enrolled) {
    const row = rows.find((r) => r.pkg === e.pkg);
    if (!row?.sec?.length) continue; // unmarked: no claim either way
    const have = parse(e.version);
    if (!have) continue;
    const fixes = row.sec
      .filter((m) => {
        const v = parse(m.v);
        if (!v || cmp(have, v) >= 0) return false;
        const since = m.since ? parse(m.since) : null;
        return !since || cmp(have, since) >= 0;
      })
      .map((m) => ({ v: m.v, why: m.why }));
    if (fixes.length) out.push({ pkg: e.pkg, have: e.version, move_to: row.ver ?? fixes[fixes.length - 1]!.v, fixes });
  }
  return out;
}

/** Served beside the list. A POSSIBILITY, never an order (D-5f65b6). */
export const SECURITY_NOTE =
  "A possibility, not a task: these adopted packages are below a release their owner marked as fixing a security defect. " +
  "Which apps upgrade, and when, is Christian's decision (D-5f65b6) — this exists so that decision is informed. " +
  "Packages without marks are simply unmarked; that says nothing either way.";

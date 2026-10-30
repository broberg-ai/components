// F039.6 — the roster answers confidently about something it has not measured.
//
// A self-reported enrollment is written once and never re-checked. Discovery
// ALREADY measures every repo's package.json files daily (data/fleet-deps.json,
// F083 scanner), one row per occurrence. So instead of a second push path, the
// session answer is RECONCILED against that measurement:
//
//   measured   — every occurrence the scan found for the session's repo
//   unreported — packages the scan found that the session never reported (partial)
//   mismatch   — a reported version that differs from an exact pin in the repo
//   stale      — an enrollment nobody has confirmed for STALE_DAYS
//
// None of these deletes or corrects anything. Stale means "nobody confirmed it
// lately", not "wrong"; a mismatch is shown, never silently fixed.

export const STALE_DAYS = 30;

export interface Occurrence { pkg: string; range: string; at: string; field?: string }
export interface Scan { scanned_at?: string; repos?: Record<string, { deps?: Record<string, Array<{ range: string; at: string; field?: string }>> }> }

/** The scanned repo for a (primary) session, or null when none can be named honestly. */
export function repoForSession(primary: string, scan: Scan, curated: Record<string, string>): string | null {
  if (curated[primary]) return scan.repos?.[curated[primary]!] ? curated[primary]! : null;
  const hits = Object.keys(scan.repos ?? {}).filter((r) => r.split("/")[1] === primary);
  return hits.length === 1 ? hits[0]! : null; // 0 or ambiguous → do not guess
}

export function measuredFor(repo: string, scan: Scan): Occurrence[] {
  const deps = scan.repos?.[repo]?.deps ?? {};
  return Object.entries(deps).flatMap(([pkg, occ]) => occ.map((o) => ({ pkg, range: o.range, at: o.at, ...(o.field ? { field: o.field } : {}) })));
}

const EXACT = /^\d+\.\d+\.\d+$/;

export function reconcile(
  enrolled: ReadonlyArray<{ pkg: string; version: string; updated_at?: string; role?: string }>,
  measured: ReadonlyArray<Occurrence>,
  nowMs: number,
): {
  unreported: string[];
  mismatch: Array<{ pkg: string; reported: string; pinned: string; at: string }>;
  stale: string[];
} {
  const reported = new Set(enrolled.map((e) => e.pkg));
  const unreported = [...new Set(measured.map((m) => m.pkg))].filter((p) => !reported.has(p)).sort();
  const mismatch = enrolled.flatMap((e) =>
    measured
      .filter((m) => m.pkg === e.pkg && EXACT.test(m.range) && m.range !== e.version)
      .map((m) => ({ pkg: e.pkg, reported: e.version, pinned: m.range, at: m.at })),
  );
  const cutoff = nowMs - STALE_DAYS * 86_400_000;
  const stale = enrolled
    .filter((e) => e.updated_at && Date.parse(e.updated_at) < cutoff)
    .map((e) => e.pkg)
    .sort();
  return { unreported, mismatch, stale };
}

// F039.6 — the roster answers confidently about something it has not measured.
//
// A self-reported enrollment is written once and never re-checked. Discovery
// ALREADY measures every repo's package.json files daily (data/fleet-deps.json,
// F083 scanner), one row per occurrence. So instead of a second push path, the
// session answer is RECONCILED against that measurement:
//
//   measured   — every occurrence the scan found for the session's repo
//   unreported — packages the scan found that the session never reported (partial)
//   mismatch   — a reported version that differs from what the repo's lockfile
//                installed (F039.6 AC7), or — with no readable lockfile — from an
//                exact pin in its package.json
//   stale      — an enrollment nobody has confirmed for STALE_DAYS
//
// None of these deletes or corrects anything. Stale means "nobody confirmed it
// lately", not "wrong"; a mismatch is shown, never silently fixed.

export const STALE_DAYS = 30;

/** `installed` is read from the repo's lockfile; `installed_unknown` says why it
 *  could not be (no lockfile, out of date, a local link …). Never both. */
export interface Occurrence { pkg: string; range: string; at: string; field?: string; installed?: string; installed_unknown?: string }
type ScanOcc = Omit<Occurrence, "pkg">;
export interface Scan { scanned_at?: string; repos?: Record<string, { deps?: Record<string, ScanOcc[]> }> }

/** The scanned repo for a (primary) session, or null when none can be named honestly. */
export function repoForSession(primary: string, scan: Scan, curated: Record<string, string>): string | null {
  if (curated[primary]) return scan.repos?.[curated[primary]!] ? curated[primary]! : null;
  const hits = Object.keys(scan.repos ?? {}).filter((r) => r.split("/")[1] === primary);
  return hits.length === 1 ? hits[0]! : null; // 0 or ambiguous → do not guess
}

export function measuredFor(repo: string, scan: Scan): Occurrence[] {
  const deps = scan.repos?.[repo]?.deps ?? {};
  return Object.entries(deps).flatMap(([pkg, occ]) => occ.map((o) => ({
    pkg, range: o.range, at: o.at,
    ...(o.field ? { field: o.field } : {}),
    ...(o.installed ? { installed: o.installed } : o.installed_unknown ? { installed_unknown: o.installed_unknown } : {}),
  })));
}

const EXACT = /^\d+\.\d+\.\d+$/;

export type Mismatch = { pkg: string; reported: string; at: string } & ({ installed: string } | { pinned: string });

export function reconcile(
  enrolled: ReadonlyArray<{ pkg: string; version: string; updated_at?: number | string; role?: string }>,
  measured: ReadonlyArray<Occurrence>,
  nowMs: number,
): {
  unreported: string[];
  mismatch: Mismatch[];
  stale: string[];
} {
  const reported = new Set(enrolled.map((e) => e.pkg));
  const unreported = [...new Set(measured.map((m) => m.pkg))].filter((p) => !reported.has(p)).sort();
  // The INSTALLED version wins when the lockfile gave one; an exact pin is the
  // fallback; a bare range is never judged.
  const mismatch = enrolled.flatMap((e) =>
    measured.flatMap((m): Mismatch[] => {
      if (m.pkg !== e.pkg) return [];
      if (m.installed) return m.installed !== e.version ? [{ pkg: e.pkg, reported: e.version, installed: m.installed, at: m.at }] : [];
      return EXACT.test(m.range) && m.range !== e.version ? [{ pkg: e.pkg, reported: e.version, pinned: m.range, at: m.at }] : [];
    }),
  );
  const cutoff = nowMs - STALE_DAYS * 86_400_000;
  // The store keeps updated_at as epoch ms (a number); accept an ISO string too.
  // An unreadable time is NOT stale — no claim is made from a value we cannot read.
  const at = (v: number | string | undefined): number =>
    typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : Number.NaN;
  const stale = enrolled
    .filter((e) => { const t = at(e.updated_at); return Number.isFinite(t) && t < cutoff; })
    .map((e) => e.pkg)
    .sort();
  return { unreported, mismatch, stale };
}

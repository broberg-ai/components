// F083.2 — merge the SCANNED dependency graph with the hand-written roster rows.
//
// The split is the whole design, and it mirrors what the package roster already
// does with `ver` versus `desc`:
//
//   DERIVED from the scan   who depends on what, at which range
//   HAND-WRITTEN, kept      what a repo IS (`r`), and what it PUBLISHES (`pub`)
//
// npm can prove a dependency exists. It cannot say what a repo is for, and it
// cannot say which packages a session OWNS — `pub` gates a session's reuse gap
// in server.ts, so deriving it from dependencies would tell a publisher to adopt
// its own package.
import { FLEET } from "./inventory-data.mjs";

/** repo -> session name. Hand-written because it is IDENTITY, not a fact a
 *  manifest carries: the names genuinely disagree (sanne/sanneandersen,
 *  fds/fysiodk-aalborg-sport, pitch/pitch-vault), and F039.7 exists because one
 *  repo has several names. A repo missing here still gets a row — under its repo
 *  name — because dropping it would read as "no dependencies". */
export const REPO_SESSION = {
  "broberg-ai/ai-sdk": "ai-sdk",
  "broberg-ai/autodoc": "autodoc",
  "broberg-ai/beacon": "beacon",
  "broberg-ai/broberg-ai-site": "broberg-ai-site",
  "webhousecode/buddy": "buddy",
  "broberg-ai/cardmem": "cardmem",
  "webhousecode/cms": "cms",
  "broberg-ai/components": "components",
  "broberg-ai/contentpush": "contentpush",
  "broberg-ai/contract-manager": "contract-manager",
  "cbroberg/coverletter-generator": "coverletter",
  "webhousecode/cronjobs": "cronjobs",
  "webhousecode/dns-mcp": "dns-mcp",
  "broberg-ai/fd-sundhed": "fd-sundhed",
  "broberg-ai/fdaa": "fdaa",
  "broberg-ai/fleet": "fleet",
  "webhousecode/fysiodk-aalborg-sport": "fds",
  "broberg-ai/happy-little-place": "happy-little-place",
  "broberg-ai/house-of-wellness": "how",
  "cbroberg/moovyy": "moovyy",
  "broberg-ai/notesmem": "notesmem",
  "broberg-ai/openbuddy": "openbuddy",
  "cbroberg/pitch": "pitch-vault",
  "webhousecode/sanneandersen": "sanne",
  "broberg-ai/storeform": "storeform",
  "broberg-ai/super-agent": "super",
  "broberg-ai/trail": "trail",
  "broberg-ai/upmetrics": "upmetrics",
  "webhousecode/vnlekerv2": "vn-leker",
  "webhousecode/whop": "whop",
  "broberg-ai/xrt81": "xrt81",
};

const short = (pkg) => pkg.replace(/^@broberg\//, "").replace(/^@upmetrics\//, "upmetrics:");

/** How old a scan may be before the page must say so out loud. A day and a half:
 *  the job runs daily, so this tolerates one missed run and no more. Without a
 *  visible age, a dead job leaves a confident number nobody can date — which is
 *  the defect this card exists to remove, one layer down. */
export const STALE_AFTER_HOURS = 36;

export function scanAge(scan, now = Date.now()) {
  const at = Date.parse(scan?.scanned_at ?? "");
  if (!Number.isFinite(at)) return { hours: null, stale: true, reason: "no scan timestamp" };
  const hours = (now - at) / 3.6e6;
  return { hours, stale: hours > STALE_AFTER_HOURS, at: scan.scanned_at };
}

/**
 * Build the rows the FLEET section renders.
 * Every repo the scan found with at least one shared dependency gets a row, plus
 * every hand-written row (a session may publish without depending on anything).
 */
export function fleetRows(scan) {
  const byName = new Map(FLEET.map((f) => [f.s, f]));
  const rows = new Map();

  for (const [repo, r] of Object.entries(scan?.repos ?? {})) {
    if (r.error) continue;
    const name = REPO_SESSION[repo] ?? repo;
    const uses = Object.keys(r.deps ?? {}).map(short).sort();
    if (!uses.length && !byName.has(name)) continue;
    const hand = byName.get(name);
    rows.set(name, {
      s: name,
      repo,
      r: hand?.r ?? repo,          // hand-written role text survives
      pub: hand?.pub ?? [],        // and so does what it publishes
      src: hand?.src ?? [],
      uses,
      note: hand?.note,
      isNew: hand?.isNew,
      manifests: r.manifests,
    });
  }
  // A hand-written row whose repo the scan did not cover still belongs on the
  // page — losing it would be a silent regression dressed as an improvement.
  for (const f of FLEET) {
    if (rows.has(f.s)) continue;
    rows.set(f.s, { ...f, uses: f.uses ?? [], pub: f.pub ?? [], src: f.src ?? [], unscanned: true });
  }
  return [...rows.values()].sort((a, b) => (b.uses.length - a.uses.length) || a.s.localeCompare(b.s));
}

/** Every consumer of a package, by session name — the question the roster is
 *  actually asked ("who already uses this?"). */
export function consumersOf(scan, pkg) {
  const out = [];
  for (const [repo, r] of Object.entries(scan?.repos ?? {})) {
    if (r.error) continue;
    if (Object.keys(r.deps ?? {}).includes(pkg)) out.push(REPO_SESSION[repo] ?? repo);
  }
  return out.sort();
}

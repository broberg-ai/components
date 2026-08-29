#!/usr/bin/env node
/**
 * F038.6 — read the LIVE API back and prove it serves what the repo says.
 *
 *   node scripts/check-live-fresh.mjs [base-url]        default: https://discovery.broberg.ai
 *
 * THIS EXISTS BECAUSE A SUCCESSFUL DEPLOY IS NOT A FRESH SITE. Measured, twice:
 *
 *   · 2026-08-14 — inventory-fresh was GREEN (the committed snapshots matched
 *     the source) while the live site had served four stale versions for three
 *     days. Nothing deployed it. A self-consistent repo and a correct site are
 *     different claims.
 *   · 2026-08-15 — flyctl printed "WARNING The app is not listening on the
 *     expected address" and then reported SUCCESS and cleared its leases. A step
 *     trusting the exit code would have gone green on that output.
 *
 * So the only thing that settles it is asking the thing the fleet reads.
 *
 * The damage is not cosmetic: every repo's CLAUDE.md tells sessions to consult
 * Discovery BEFORE building, and cardmem_session_start hands each repo a reuse
 * gap computed from this data. For three days that gap pointed at
 * @broberg/webpush 0.2.1 — the version whose icon path renders nothing on iOS,
 * silently, which cost xrt81 a full day.
 */
import { DATA } from "./inventory-data.mjs";

const base = (process.argv[2] ?? "https://discovery.broberg.ai").replace(/\/$/, "");
const url = `${base}/api/packages`;

// F038.9's lesson, applied at birth here rather than after it bites: "the site
// did not answer" and "the site is stale" are two findings that send the reader
// to two different places, so they get two different messages and neither
// mentions the other.
let res;
try {
  res = await fetch(url);
} catch (err) {
  console.error(`\n  Could not reach ${url}\n  ${err instanceof Error ? err.message : String(err)}\n  Nothing was checked.\n`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`\n  ${res.status} ${res.statusText} from ${url}\n  The site did not answer; nothing was checked.\n`);
  process.exit(1);
}

const body = await res.json();
const live = new Map(
  (Array.isArray(body) ? body : (body.packages ?? body.results ?? [])).map((p) => [p.pkg ?? p.name, p.ver ?? p.version]),
);

// A body that parses but carries no packages is a THIRD state, and it must not
// read as "everything matched". An empty comparison passes vacuously.
if (live.size === 0) {
  console.error(`\n  ${url} answered 200 with no packages.\n  Nothing was compared; this is not a pass.\n`);
  process.exit(1);
}

const want = DATA.flatMap((L) => L.items ?? [])
  .filter((it) => it.s === "shipped" && String(it.pkg ?? "").startsWith("@broberg/"))
  .map((it) => ({ pkg: it.pkg, ver: it.ver }));

const missing = want.filter((w) => !live.has(w.pkg));
const stale = want.filter((w) => live.has(w.pkg) && live.get(w.pkg) !== w.ver);

if (stale.length || missing.length) {
  // Name every one. "the site is stale" sends someone to look; a list tells them
  // whether one release did not land or the whole deploy never ran.
  const lines = [
    ...stale.map((w) => `    ${w.pkg}   live ${live.get(w.pkg)}   repo ${w.ver}`),
    ...missing.map((w) => `    ${w.pkg}   MISSING from the live roster   repo ${w.ver}`),
  ];
  console.error(
    `\n  ${url} is serving stale data — ${stale.length} stale, ${missing.length} missing, of ${want.length} shipped packages:\n` +
      lines.join("\n") +
      `\n\n  The repo and the registry may both be right; what the FLEET reads is not.\n`,
  );
  process.exit(1);
}

console.log(`✓ live roster matches the repo: ${want.length} shipped packages, 0 stale, 0 missing (${url})`);

#!/usr/bin/env node
/**
 * F038.10 — does the ROSTER agree with npm?
 *
 *   node scripts/check-roster-versions.mjs
 *
 * WHAT THE OTHER TWO CHECKS DO NOT DO, which is why this exists:
 *
 *   check          the generated pages match scripts/inventory-data.mjs
 *   live-fresh     the live site matches this repo
 *   THIS           this repo matches NPM
 *
 * The first two prove the pipeline is consistent with itself. Neither can see a
 * roster that is simply wrong, and a wrong roster is the failure with actual
 * victims: every repo's CLAUDE.md tells sessions to consult Discovery BEFORE
 * building, and cardmem_session_start hands each repo a reuse gap computed from
 * this data.
 *
 * Measured 2026-08-29: @broberg/notifications 0.3.0 was published without the
 * roster being bumped. `live-fresh` went GREEN — because the live site and the
 * repo agreed with each other, and both were behind. It was caught only because
 * the hero card happens to be generated from npm and notifications happened to
 * be the newest release. Publish a patch to anything that is NOT the newest and
 * nothing would have asked.
 *
 * FOUR OUTCOMES PER ROW, and the ordering of them is the design:
 *
 *   in sync        roster ver === npm latest
 *   BEHIND         npm has moved on. The fleet installs an old version.
 *   AHEAD          the roster names a version NPM DOES NOT HAVE. This is the
 *                  direction that actually burns people — a session told to
 *                  install it gets a 404 — and it is the one a "just take npm's
 *                  answer" auto-fixer would paper over. (webpush precedent.)
 *   could not ask  a THIRD state, never merged into "fine". The F038.9 lesson,
 *                  applied at birth rather than after it bites.
 *
 * EXIT CODES follow the house pattern already used for @broberg/cron's
 * contract-drift check (see test.yml):
 *
 *   0   every row we could ask about agrees
 *   1   at least one row is BEHIND or AHEAD          → the workflow fails
 *   2   nothing was wrong, but some rows were UNASKABLE → the workflow warns
 *
 * A REAL FINDING BEATS AN INSTRUMENT PROBLEM. If one package is stale and
 * another is unreachable, this exits 1, not 2 — a guard whose "I could not
 * measure" branch outranks its "I measured something wrong" branch hides the
 * finding behind the excuse.
 */
import { DATA } from "./inventory-data.mjs";

const REGISTRY = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org";

/** null means COULD NOT ASK — deliberately distinct from any version string. */
async function latestOnNpm(pkg) {
  try {
    const res = await fetch(`${REGISTRY}/${pkg.replace("/", "%2F")}`, {
      signal: AbortSignal.timeout(15_000),
    });
    // A 404 is not "could not ask" — the registry answered, and its answer is
    // that this package does not exist. That is a roster problem, so it must
    // reach the AHEAD branch rather than being excused as an outage.
    if (res.status === 404) return { missing: true };
    if (!res.ok) return null;
    const doc = await res.json();
    const version = doc?.["dist-tags"]?.latest;
    return version ? { version } : null;
  } catch {
    return null;
  }
}

const rows = DATA.flatMap((L) => L.items ?? [])
  .filter((it) => it.s === "shipped" && String(it.pkg ?? "").startsWith("@broberg/"))
  .map((it) => ({ pkg: it.pkg, ver: it.ver }));

if (!rows.length) {
  // An empty comparison passes vacuously, and that must not read as a sweep.
  console.error("\n  No shipped @broberg/* rows found in the roster.\n  Nothing was compared; this is not a pass.\n");
  process.exit(1);
}

const answers = await Promise.all(rows.map((r) => latestOnNpm(r.pkg)));

const behind = [];
const ahead = [];
const unaskable = [];

rows.forEach((r, i) => {
  const a = answers[i];
  if (a === null) return unaskable.push(r);
  if (a.missing) return ahead.push({ ...r, npm: "not published at all" });
  if (a.version === r.ver) return;
  // Which side is in front decides which message you get, because they send the
  // reader to two different places: BEHIND is "bump the roster", AHEAD is "the
  // roster is lying and somebody's install is about to 404".
  const older = [r.ver, a.version].sort(cmpVersion)[0];
  (older === r.ver ? behind : ahead).push({ ...r, npm: a.version });
});

function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

if (ahead.length) {
  console.error(
    `\n  ✗ ${ahead.length} roster row(s) name a version NPM DOES NOT SERVE — a session told to install this gets a 404:\n` +
      ahead.map((r) => `    ${r.pkg}   roster ${r.ver}   npm ${r.npm}`).join("\n"),
  );
}
if (behind.length) {
  console.error(
    `\n  ✗ ${behind.length} roster row(s) are BEHIND npm — the fleet is being told to install an old version:\n` +
      behind.map((r) => `    ${r.pkg}   roster ${r.ver}   npm ${r.npm}`).join("\n") +
      `\n\n  Fix: update ver in scripts/inventory-data.mjs, then` +
      `\n       bun scripts/build-inventory.mjs && bun scripts/build-onboarding.mjs` +
      `\n  Only ver. Role text and maturity are the owner's to speak to — npm can prove a` +
      `\n  version exists and cannot prove what a package now does.`,
  );
}
if (unaskable.length) {
  console.error(
    `\n  ? ${unaskable.length} row(s) could NOT be checked — the registry did not answer:\n` +
      unaskable.map((r) => `    ${r.pkg}   roster ${r.ver}`).join("\n") +
      `\n  These were not verified. It is not a finding about them, and not a pass either.`,
  );
}

if (ahead.length || behind.length) {
  console.error(`\n  ${rows.length - unaskable.length} of ${rows.length} rows checked.\n`);
  process.exit(1);
}
if (unaskable.length) {
  console.error(`\n  ${rows.length - unaskable.length} of ${rows.length} rows checked, all in sync.\n`);
  process.exit(2);
}
console.log(`✓ roster matches npm: ${rows.length} shipped packages, 0 behind, 0 ahead, 0 unreachable`);

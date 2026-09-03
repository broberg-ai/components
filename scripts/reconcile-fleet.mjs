#!/usr/bin/env node
// F083.4 — the scan and the self-reports answer DIFFERENT questions, and the
// disagreement is the finding.
//
//   the scan          what a repo INSTALLS   (package.json, ground truth)
//   /api/enrollments  what a session SAID    (voluntary, carries role + notes)
//
// The direction that costs: a stale or missing enrollment UNDERSTATES how widely
// a package is installed, so it understates the blast radius of a breaking
// release. Every session's `discovery_reuse` gap is computed from enrollments,
// so a repo that depends on a package without enrolling is told to adopt
// something it already has.
//
//   node scripts/reconcile-fleet.mjs [--json]
import { readFileSync } from "node:fs";
import { REPO_SESSION } from "./fleet-graph.mjs";

const DISCOVERY = process.env.DISCOVERY_URL ?? "https://discovery.broberg.ai";

export function reconcile(scan, enrollments) {
  const installed = new Map();   // session -> Set(pkg)
  const unmapped = [];
  for (const [repo, r] of Object.entries(scan.repos ?? {})) {
    if (r.error) continue;
    const session = REPO_SESSION[repo];
    if (!session) { if (Object.keys(r.deps ?? {}).length) unmapped.push(repo); continue; }
    installed.set(session, new Set(Object.keys(r.deps ?? {})));
  }
  // `role: "src"` means the session ORIGINATED the package, not that it installs
  // it. components enrolled as src for nine packages it owns and does not
  // consume — counting those as "enrolled but not installed" produced nine
  // findings that were all correct behaviour. A role is not a claim of use.
  const declared = new Map();
  const originated = new Map();
  for (const e of enrollments) {
    const bucket = e.role === "src" ? originated : declared;
    if (!bucket.has(e.session)) bucket.set(e.session, new Set());
    bucket.get(e.session).add(e.pkg);
  }

  const installedNotDeclared = [];
  const said_ = (session) => new Set([...(declared.get(session) ?? []), ...(originated.get(session) ?? [])]);
  const declaredNotInstalled = [];
  for (const [session, pkgs] of installed) {
    const said = said_(session);
    for (const p of pkgs) if (!said.has(p)) installedNotDeclared.push({ session, pkg: p });
  }
  for (const [session, pkgs] of declared) {
    // A session with no scanned repo cannot be judged — silence is not a finding.
    if (!installed.has(session)) continue;
    const has = installed.get(session);
    for (const p of pkgs) if (!has.has(p)) declaredNotInstalled.push({ session, pkg: p });
  }
  // An enrollment under a raw UUID is a real row someone should claim, not noise.
  const unnamed = [...new Set([...declared.keys(), ...originated.keys()])].filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s));
  const sessionsNeverScanned = [...new Set([...declared.keys(), ...originated.keys()])].filter((s) => !installed.has(s) && !unnamed.includes(s));

  return { installedNotDeclared, declaredNotInstalled, originatedCount: [...originated.values()].reduce((n,v)=>n+v.size,0), unmappedRepos: unmapped, unnamedEnrollments: unnamed, sessionsNeverScanned };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const scan = JSON.parse(readFileSync(new URL("../data/fleet-deps.json", import.meta.url), "utf8"));
  const res = await fetch(`${DISCOVERY}/api/enrollments`);
  if (!res.ok) { console.error(`could not read ${DISCOVERY}/api/enrollments — HTTP ${res.status}`); process.exit(1); }
  const enrollments = (await res.json()).enrollments ?? [];
  const r = reconcile(scan, enrollments);

  if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }

  const g = (a) => a.reduce((m, x) => ((m[x.session] ??= []).push(x.pkg.replace("@broberg/", "")), m), {});
  console.log(`scan ${scan.edges} edges · enrollments ${enrollments.length}\n`);
  console.log(`INSTALLED BUT NEVER ENROLLED (${r.installedNotDeclared.length}) — these repos are told to adopt what they already have:`);
  for (const [s, p] of Object.entries(g(r.installedNotDeclared))) console.log(`  ${s.padEnd(22)} ${p.sort().join(", ")}`);
  console.log(`\nENROLLED BUT NOT IN ANY MANIFEST (${r.declaredNotInstalled.length}) — a self-report that has gone stale:`);
  for (const [s, p] of Object.entries(g(r.declaredNotInstalled))) console.log(`  ${s.padEnd(22)} ${p.sort().join(", ")}`);
  if (r.sessionsNeverScanned.length) console.log(`\nENROLLED, NO SCANNED REPO (${r.sessionsNeverScanned.length}): ${r.sessionsNeverScanned.join(", ")}`);
  if (r.unnamedEnrollments.length) console.log(`\nENROLLED UNDER A RAW UUID (${r.unnamedEnrollments.length}) — somebody should claim these: ${r.unnamedEnrollments.join(", ")}`);
  if (r.unmappedRepos.length) console.log(`\nSCANNED BUT UNMAPPED (${r.unmappedRepos.length}) — add them to REPO_SESSION: ${r.unmappedRepos.join(", ")}`);
  console.log(`\nAbsence in EITHER source is not evidence of non-use: enrolment is voluntary, and a repo can drive a package as a SERVICE (via the cardmem daemon or an MCP) without ever installing it.`);
}

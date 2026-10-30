#!/usr/bin/env node
// F083.4 — the scan vs the self-reports. Each direction is its own finding.
//
//   node scripts/test-reconcile-fleet.mjs
import { reconcile } from "./reconcile-fleet.mjs";
import { REPO_SESSION } from "./fleet-graph.mjs";

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); failures++; }
};
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`); };

// A real mapped repo, so the test exercises the real REPO_SESSION table.
const [repo, session] = Object.entries(REPO_SESSION)[0];
const scan = (deps, extra = {}) => ({ repos: { [repo]: { deps: Object.fromEntries(deps.map((p) => [p, [{ range: "1.0.0", at: "package.json" }]])) }, ...extra } });
const en = (pkg, role = "uses", s = session) => ({ session: s, pkg, version: "1.0.0", role });

console.log("reconcile-fleet");

check("AC0: both directions are reported SEPARATELY", () => {
  const r = reconcile(scan(["@broberg/a", "@broberg/b"]), [en("@broberg/b"), en("@broberg/c")]);
  eq(r.installedNotDeclared, [{ session, pkg: "@broberg/a" }], "installed but never enrolled");
  eq(r.declaredNotInstalled, [{ session, pkg: "@broberg/c" }], "enrolled but in no manifest");
});

check("AC1: a scanned repo with dependencies that CANNOT be mapped is reported, never dropped", () => {
  const r = reconcile(scan([], { "someone/unknown-repo": { deps: { "@broberg/a": [{ range: "1", at: "package.json" }] } } }), []);
  eq(r.unmappedRepos, ["someone/unknown-repo"], "unmapped repo named");
});

check("AC1: a failed repo is not judged (an error is not 'no dependencies')", () => {
  const r = reconcile({ repos: { [repo]: { error: "404" } } }, [en("@broberg/a")]);
  eq(r.declaredNotInstalled, [], "no finding from a read that failed");
  eq(r.sessionsNeverScanned, [session], "named as never scanned instead");
});

check("AC2: an enrollment under a raw UUID is surfaced, not filtered", () => {
  const r = reconcile(scan([]), [en("@broberg/a", "uses", "01a0b2c3-d4e5-7f00-8000-000000000000")]);
  eq(r.unnamedEnrollments, ["01a0b2c3-d4e5-7f00-8000-000000000000"], "uuid row kept");
});

check("role src is not a claim of use — never 'enrolled but not installed'", () => {
  eq(reconcile(scan([]), [en("@broberg/a", "src")]).declaredNotInstalled, [], "src");
});

check("role not_relevant (F039.6) is the opposite of a claim of use — never 'enrolled but not installed'", () => {
  eq(reconcile(scan([]), [en("@broberg/a", "not_relevant")]).declaredNotInstalled, [], "not_relevant");
});

console.log(failures ? `\n${failures} FAILED` : "\nall green");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
// F082.10 — the shared advisory watch's decisions (scripts/advisory/engine.mjs).
// Each case is one of bid's requirements (#4318) or BID's production behaviour.
import assert from "node:assert/strict";
import { detectPm, parseAudit, lockedFromLockfile, validateAck, decide, planAlarm, issueTitle, ERROR_ID, isTestRun, TEST_PREFIX, githubRepo, inRange, patchedOnLine, repoFindings, directDeps } from "./advisory/engine.mjs";
import { readFileSync } from "node:fs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const ZOD = { pkg: "zod", id: "GHSA-mrhx-c7xc-m3w5", severity: "high", title: "Zod can exhaust memory" };

t("package manager from the lockfile; bun wins over a stray package-lock", () => {
  assert.equal(detectPm(["package.json", "bun.lock", "package-lock.json"]), "bun");
  assert.equal(detectPm(["pnpm-lock.yaml"]), "pnpm");
  assert.equal(detectPm(["package-lock.json"]), "npm");
  assert.equal(detectPm(["package.json"]), null);
});

t("audit JSON of all three managers → one row per (pkg, id)", () => {
  const bun = parseAudit("bun", 'noise {"zod":[{"id":1,"url":"https://github.com/advisories/GHSA-mrhx-c7xc-m3w5","title":"t","severity":"high"}]}');
  assert.deepEqual(bun, [{ pkg: "zod", id: "GHSA-mrhx-c7xc-m3w5", severity: "high", title: "t" }]);
  const pnpm = parseAudit("pnpm", JSON.stringify({ advisories: { 1: { module_name: "zod", github_advisory_id: "GHSA-a", severity: "high", title: "t" }, 2: { module_name: "zod", github_advisory_id: "GHSA-a", severity: "high", title: "t" } } }));
  assert.equal(pnpm.length, 1);
  const npm = parseAudit("npm", JSON.stringify({ vulnerabilities: {
    zod: { severity: "high", via: [{ source: 1, name: "zod", url: "https://github.com/advisories/GHSA-b", severity: "high", title: "t" }] },
    app: { severity: "high", via: ["zod"] } } }));
  assert.deepEqual(npm.map((f) => `${f.pkg} ${f.id}`), ["zod GHSA-b"]);
});

t("not an audit report → throws (the caller records «could not check»)", () => {
  assert.throws(() => parseAudit("bun", "error: lockfile missing"), /no JSON/);
  assert.throws(() => parseAudit("pnpm", '{"error":{"message":"ERR_PNPM_AUDIT_BAD_RESPONSE"}}'), /ERR_PNPM/);
  assert.throws(() => parseAudit("npm", '{"error":{"summary":"ENOLOCK"}}'), /ENOLOCK/);
});

t("locked packages from each lockfile; workspace links skipped", () => {
  const npm = JSON.stringify({ packages: { "": {}, "node_modules/zod": { version: "4.6.5" }, "node_modules/@a/b": { version: "1.0.0" }, "node_modules/w": { link: true } } });
  assert.deepEqual([...lockedFromLockfile("npm", npm)].sort(), ["@a/b@1.0.0", "zod@4.6.5"]);
  const pnpm = "lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n\npackages:\n\n  '@a/b@1.0.0':\n    resolution: {}\n\n  zod@4.6.5:\n    resolution: {}\n\nsnapshots:\n\n  zod@4.6.5: {}\n";
  assert.deepEqual([...lockedFromLockfile("pnpm", pnpm)].sort(), ["@a/b@1.0.0", "zod@4.6.5"]);
  const bun = '{\n  "packages": {\n    "zod": ["zod@4.6.5", "", {}, "sha512-x"],\n    "@a/b": ["@a/b@1.0.0", "", {}, "sha"],\n    "w": ["w@workspace:packages/w"],\n  }\n}';
  assert.deepEqual([...lockedFromLockfile("bun", bun)].sort(), ["@a/b@1.0.0", "zod@4.6.5"]);
});

t("an acknowledgement without a reason is not one — the run is red", () => {
  assert.deepEqual(validateAck({ zod: { ids: [ZOD.id], reason: "only bounded input reaches zod in this service" } }), []);
  assert.equal(validateAck({ zod: { ids: [ZOD.id], reason: "" } }).length, 1);
  assert.equal(validateAck({ zod: { ids: [], reason: "only bounded input reaches zod here" } }).length, 1);
  const r = decide({ audit: [ZOD], ack: { zod: { ids: [ZOD.id] } } });
  assert.equal(r.status, "error");
  assert.equal(r.acknowledged.length, 0); // a broken ack file acknowledges nothing
});

t("acknowledged id passes; a NEW id on the same package still blocks; moderate never blocks", () => {
  const ack = { zod: { ids: [ZOD.id], reason: "only bounded input reaches zod in this service" } };
  assert.equal(decide({ audit: [ZOD], ack }).status, "clean");
  assert.equal(decide({ audit: [ZOD, { ...ZOD, id: "GHSA-new" }], ack }).status, "blocking");
  assert.equal(decide({ audit: [{ ...ZOD, severity: "moderate" }] }).status, "clean");
});

t("audit and OSV agree → one finding with both sources; KEV carried", () => {
  const r = decide({ audit: [ZOD], osv: [{ ...ZOD, kev: true }, { ...ZOD, kev: false }] });
  assert.equal(r.blocking.length, 1);
  assert.deepEqual(r.blocking[0].sources, ["audit", "osv"]);
  assert.equal(r.blocking[0].kev, true);
});

t("could not run audit or OSV → error, never clean", () => {
  assert.equal(decide({ auditError: "bun audit: no JSON" }).status, "error");
  assert.equal(decide({ osvError: "OSV: HTTP 503" }).status, "error");
});

t("BID's title — «[id]» is the key, so BID's open issues match", () => {
  assert.equal(issueTitle(ZOD), "[GHSA-mrhx-c7xc-m3w5] high: zod — Zod can exhaust memory");
});

t("alarm: opens new holes, does not duplicate, closes gone ones", () => {
  const blocking = decide({ audit: [ZOD] });
  assert.deepEqual(planAlarm(blocking, [{ number: 3, title: issueTitle(ZOD) }]), { open: [], close: [] });
  assert.equal(planAlarm(blocking, []).open[0].id, ZOD.id);
  assert.deepEqual(planAlarm(decide({}), [{ number: 3, title: issueTitle(ZOD) }]).close.map((s) => s.number), [3]);
});

t("alarm on error: one [audit-error] issue, and NOTHING is closed", () => {
  const p = planAlarm(decide({ auditError: "x", audit: [] }), [{ number: 3, title: issueTitle(ZOD) }]);
  assert.deepEqual(p.close, []);
  assert.deepEqual(p.open.map((f) => f.id), [ERROR_ID]);
  // and once checking works again, the error issue is closed
  assert.deepEqual(planAlarm(decide({}), [{ number: 9, title: `[${ERROR_ID}] critical: x` }]).close.map((s) => s.number), [9]);
});

t("a run off the default branch is a TEST — and test and real issues never touch each other (bid #4336)", () => {
  assert.equal(isTestRun("pilot/x", "main"), true);
  assert.equal(isTestRun("main", "main"), false);
  assert.equal(isTestRun("main", undefined), false); // unknown default → treated as real, as before
  assert.equal(issueTitle(ZOD, true), `${TEST_PREFIX}${issueTitle(ZOD)}`);
  const real = { number: 1, title: issueTitle(ZOD) }, test = { number: 2, title: issueTitle(ZOD, true) };
  // a clean pilot closes its own TEST issue, never the real alarm
  assert.deepEqual(planAlarm(decide({}), [real, test], true).close.map((s) => s.number), [2]);
  assert.deepEqual(planAlarm(decide({}), [real, test], false).close.map((s) => s.number), [1]);
  // a blocking pilot opens its own TEST issue even while the real one is open
  assert.equal(planAlarm(decide({ audit: [ZOD] }), [real], true).open.length, 1);
  assert.equal(planAlarm(decide({ audit: [ZOD] }), [test], false).open.length, 1);
  // and a pilot that is still red does not open a second TEST issue every run
  assert.equal(planAlarm(decide({ audit: [ZOD] }), [test], true).open.length, 0);
});

// F082.11 — repository advisories (bid #56991): published on the source repo,
// not yet in GitHub's reviewed database, so audit and OSV never saw them.
const BA = JSON.parse(readFileSync(new URL("./advisory/fixtures/better-auth-repo-advisories.json", import.meta.url), "utf8"));

t("repository URL → owner/repo, GitHub only", () => {
  assert.equal(githubRepo({ url: "git+https://github.com/better-auth/better-auth.git", directory: "packages/better-auth" }), "better-auth/better-auth");
  assert.equal(githubRepo("github:colinhacks/zod"), "colinhacks/zod");
  assert.equal(githubRepo("colinhacks/zod"), "colinhacks/zod");
  assert.equal(githubRepo("git@github.com:a/b.git"), "a/b");
  assert.equal(githubRepo("https://gitlab.com/a/b"), null);
  assert.equal(githubRepo(undefined), null);
});

t("GitHub's version ranges on Better Auth's real advisories, prereleases included", () => {
  assert.equal(inRange("1.7.14", "< 1.7.16"), true);
  assert.equal(inRange("1.7.16", "< 1.7.16"), false);
  assert.equal(inRange("1.8.0-beta.3", ">= 1.8.0-beta.0, < 1.8.0-beta.5"), true);
  assert.equal(inRange("1.8.0-beta.5", ">= 1.8.0-beta.0, < 1.8.0-beta.5"), false);
  assert.equal(inRange("1.8.0", ">= 1.8.0-beta.0, < 1.8.0-beta.5"), false);
  assert.equal(inRange("1.6.20", "<= 1.6.20"), true);
  assert.equal(inRange("0.4.8", ">= 0.4.9, < 1.7.16"), false);
  assert.equal(inRange("1.7.0-rc.3", ">= 1.3.8-beta.3, < 1.7.0-rc.3"), false);
  assert.equal(inRange("1.7.0-rc.2", ">= 1.3.8-beta.3, < 1.7.0-rc.3"), true);
  assert.equal(inRange("1.0.0", "= 1.0.0"), true);
  // some repos write the AND without a comma (measured 28/11 on a components dependency)
  assert.equal(inRange("2.5.0", ">= 2.0.0 < 2.8.3"), true);
  assert.equal(inRange("2.8.3", ">= 2.0.0 < 2.8.3"), false);
  // partial versions, read like npm: the missing parts are a wildcard
  assert.equal(inRange("19.9.9", "< 20"), true);
  assert.equal(inRange("20.0.0", "< 20"), false);
  assert.equal(inRange("1.2.9", "<= 1.2"), true);
  assert.equal(inRange("1.3.0", "<= 1.2"), false);
  assert.equal(inRange("1.2.0", ">= 1.2, < 1.4"), true);
  assert.equal(inRange("1.2.5", "= 1.2"), true);
  assert.equal(inRange("2.0.0", "> 1"), true);
  assert.equal(inRange("1.9.0", "> 1"), false);
  assert.equal(inRange("8.4.0-beta.1", "8.4.0-beta.1"), true); // a bare version = exactly it
  assert.equal(inRange("8.4.0", "8.4.0-beta.1"), false);
  assert.throws(() => inRange("1.0.0", "~> 1.0"), /range/);
  // the other real forms (measured 28/11 on components' dependency repos)
  assert.equal(inRange("15.1.0", ">15.0.4 and <15.2.0"), true);
  assert.equal(inRange("15.2.0", ">15.0.4 and <15.2.0"), false);
  assert.equal(inRange("1.20.0", "1 <=1.28.1 || 2 <=2.0.5 || 3 <=3.20.3"), true);
  assert.equal(inRange("2.0.6", "1 <=1.28.1 || 2 <=2.0.5 || 3 <=3.20.3"), false);
  assert.equal(inRange("6.1.0", "1 <=1.28.1 || 2 <=2.0.5 || 3 <=3.20.3"), false);
  assert.equal(inRange("15.3.0", "15.0.0 - 15.4.4"), true);
  assert.equal(inRange("15.4.5", "15.0.0 - 15.4.4"), false);
  assert.throws(() => inRange("15.1.0", "< 14.2.31, 15.0.0 - 15.4.4"), /range/); // comma + hyphen: OR or AND? not guessed
  assert.throws(() => inRange("16.3.1", ">= 16.0.0 < 16.3.?"), /range/);
});

t("patched_versions on the locked major clears a broken range — a fix on another major never does", () => {
  const p = "v16.0.7, v15.5.7, v15.4.8, 15.6.0-canary.58, 16.1.0-canary.12"; // next.js GHSA-9qr9-h5gf-34mp
  assert.equal(inRange("16.4.5", ">=14.3.0-canary.77, >=15, >=16"), true); // the range alone says vulnerable
  assert.equal(patchedOnLine("16.4.5", p), true);   // … but 16.4.5 has the 16.x fix
  assert.equal(patchedOnLine("16.0.5", p), false);  // below the fix
  assert.equal(patchedOnLine("5.4.21", "8.3.7, 7.3.8, 6.4.6"), false); // vite: no 5.x fix → stays red
  assert.equal(patchedOnLine("1.7.14", null), false);
  // next.js GHSA-gp8f: ">=13.5.1", fixed in 13.5.7 and 14.2.10 → a later major has it
  assert.equal(patchedOnLine("16.4.5", "13.5.7", ["14.2.10"]), true);
  assert.equal(patchedOnLine("14.2.9", "14.2.10", ["13.5.7"]), false);
  // better-auth GHSA-fmh4: an OLDER fix on the same major (1.6.11) does not clear 1.7.7 — the 1.7 fix is 1.7.16
  assert.equal(patchedOnLine("1.7.7", "1.6.11, 1.7.16"), false);
  assert.equal(patchedOnLine("1.7.20", "1.6.11, 1.7.16"), true);
  const fmh4 = [{ ghsa_id: "GHSA-fmh4-wcc4-5jm3", severity: "high", summary: "x", vulnerabilities: [
    { package: { ecosystem: "npm", name: "better-auth" }, vulnerable_version_range: "< 1.6.11", patched_versions: "1.6.11" },
    { package: { ecosystem: "npm", name: "better-auth" }, vulnerable_version_range: ">= 1.6.14, < 1.7.16", patched_versions: "1.7.16" }] }];
  assert.equal(repoFindings(fmh4, new Set(["better-auth@1.7.7"])).length, 1);
  assert.deepEqual(repoFindings(fmh4, new Set(["better-auth@1.6.12"])), []);
  // drizzle GHSA-gpj5: the beta line's "<= 1.0.0-beta.19" also matches 0.45.2 — the 0.45.x fix itself
  const dz = [{ ghsa_id: "GHSA-gpj5-g38j-94v9", severity: "high", summary: "x", vulnerabilities: [
    { package: { ecosystem: "npm", name: "drizzle-orm" }, vulnerable_version_range: "<= 0.45.1", patched_versions: "0.45.2" },
    { package: { ecosystem: "npm", name: "drizzle-orm" }, vulnerable_version_range: "<= 1.0.0-beta.19", patched_versions: "1.0.0-beta.20" }] }];
  assert.deepEqual(repoFindings(dz, new Set(["drizzle-orm@0.45.2"])), []);
  assert.equal(repoFindings(dz, new Set(["drizzle-orm@0.45.1"])).length, 1);
  assert.equal(repoFindings(dz, new Set(["drizzle-orm@1.0.0-beta.19"])).length, 1);
  const next = [{ ghsa_id: "GHSA-9qr9-h5gf-34mp", severity: "critical", summary: "RCE", vulnerabilities: [{ package: { ecosystem: "npm", name: "next" }, vulnerable_version_range: ">=14.3.0-canary.77, >=15, >=16", patched_versions: p }] }];
  assert.deepEqual(repoFindings(next, new Set(["next@16.4.5"])), []);
  assert.equal(repoFindings(next, new Set(["next@16.0.5"])).length, 1);
});

t("Better Auth 1.7.14 → three findings incl. the critical one; 1.7.16 → none; @better-auth/expo matched by its own name", () => {
  const locked = new Set(["better-auth@1.7.14", "zod@4.6.5"]);
  const f = repoFindings(BA, locked);
  assert.deepEqual(f.map((x) => `${x.pkg} ${x.id} ${x.severity}`).sort(), [
    "better-auth GHSA-4wq4-2ppv-q3hg critical", "better-auth GHSA-9hm7-xhfp-cx58 medium", "better-auth GHSA-g95c-wqvr-8c3j medium"]);
  assert.deepEqual(repoFindings(BA, new Set(["better-auth@1.7.16"])), []);
  // the issue links the advisory where it IS published (OSV does not have it yet)
  const withUrl = BA.map((a) => ({ ...a, html_url: `https://github.com/better-auth/better-auth/security/advisories/${a.ghsa_id}` }));
  assert.equal(repoFindings(withUrl, locked)[0].url.startsWith("https://github.com/better-auth/better-auth/security/advisories/GHSA-"), true);
  assert.deepEqual(repoFindings(BA, new Set(["@better-auth/expo@1.4.0-beta.6"])).map((x) => x.pkg), ["@better-auth/expo"]);
  // an unreadable range is reported for the locked package and skipped — the rest still counts
  const bad = [{ ...BA[0], ghsa_id: "GHSA-bad", vulnerabilities: [{ package: { ecosystem: "npm", name: "better-auth" }, vulnerable_version_range: ">= 16.0.0 < 16.3.?" }] }, ...BA];
  const unparsed = [];
  assert.equal(repoFindings(bad, locked, unparsed).length, 3);
  assert.deepEqual(unparsed, [{ pkg: "better-auth", id: "GHSA-bad", range: ">= 16.0.0 < 16.3.?" }]);
  // withdrawn and non-npm advisories are not findings
  const w = BA.map((a) => ({ ...a, withdrawn_at: "2026-11-04T00:00:00Z" }));
  assert.deepEqual(repoFindings(w, locked), []);
  const pip = BA.map((a) => ({ ...a, vulnerabilities: a.vulnerabilities.map((v) => ({ ...v, package: { ...v.package, ecosystem: "pip" } })) }));
  assert.deepEqual(repoFindings(pip, locked), []);
});

t("decide(): a repo-only critical is RED, and merges with OSV by id once GitHub reviews it", () => {
  const repo = repoFindings(BA, new Set(["better-auth@1.7.14"]));
  const r = decide({ repo });
  assert.equal(r.status, "blocking");
  assert.deepEqual(r.blocking.map((f) => [f.id, f.sources]), [["GHSA-4wq4-2ppv-q3hg", ["repo"]]]);
  const later = decide({ repo, osv: [{ pkg: "better-auth", id: "GHSA-4wq4-2ppv-q3hg", severity: "critical", title: "x" }] });
  assert.deepEqual(later.blocking.map((f) => [f.id, f.sources.sort()]), [["GHSA-4wq4-2ppv-q3hg", ["osv", "repo"]]]);
  // acknowledged like any other source
  assert.equal(decide({ repo, ack: { "better-auth": { ids: ["GHSA-4wq4-2ppv-q3hg"], reason: "expo plugin not used — no native client" } } }).status, "clean");
  // could not look → red, closes nothing
  assert.equal(decide({ repoError: "repo advisories: GitHub 403 (rate limit)" }).status, "error");
});

t("direct dependencies from root + workspace package.json files", () => {
  const d = directDeps([
    { dependencies: { "better-auth": "^1.7.14" }, devDependencies: { vitest: "2" } },
    { dependencies: { zod: "^4", "@w/x": "workspace:*" }, peerDependencies: { react: "19" }, optionalDependencies: { sharp: "1" } },
  ]);
  assert.deepEqual([...d].sort(), ["better-auth", "react", "sharp", "vitest", "zod"]);
});

console.log(`\nadvisory engine: ${n} checks passed`);

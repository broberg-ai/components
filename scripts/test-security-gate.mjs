#!/usr/bin/env node
// F427.1 — the fleet security gate's decisions: every rule, both directions. Pure — no network, no tool.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHECKS, MAX_ACK_DAYS, validateAcks, acked, isMalicious, decideDeps, decideSast, decideWorkflows, decideInstall, overall, render,
} from "./security-gate/decide.mjs";
import { parsePnpm, parseNpm, parseBun, parseJsonc, findLockfiles } from "./security-gate/lockfiles.mjs";
import { runZizmor, runSemgrep } from "./security-gate/run-check.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const TODAY = "2026-11-20";
const ack = (o = {}) => ({ id: "GHSA-aaaa", reason: "cannot reach a user: dev-only tool", expires: "2026-12-20", ...o });

// ---------------------------------------------------------------- acks
t("an ack with id, reason and a near expiry counts", () => assert.equal(validateAcks({ acks: [ack()] }, TODAY).valid.length, 1));
t("an EXPIRED ack silences nothing and says why", () => {
  const r = validateAcks({ acks: [ack({ expires: "2026-11-19" })] }, TODAY);
  assert.equal(r.valid.length, 0); assert.match(r.rejected[0].why, /expired/);
});
t("an ack that expires TODAY still counts (the deadline is the end of that day)", () => assert.equal(validateAcks({ acks: [ack({ expires: TODAY })] }, TODAY).valid.length, 1));
t(`an ack more than ${MAX_ACK_DAYS} days out is refused — a deadline, not a permanent exemption`, () => {
  assert.equal(validateAcks({ acks: [ack({ expires: "2027-05-18" })] }, TODAY).valid.length, 1); // 179 days
  assert.equal(validateAcks({ acks: [ack({ expires: "2027-05-20" })] }, TODAY).valid.length, 0); // 181 days
});
t("no reason, a one-word reason, no id, a bad date: each refused", () => {
  for (const bad of [ack({ reason: "" }), ack({ reason: "ok" }), ack({ id: "" }), ack({ expires: "soon" }), ack({ expires: undefined })])
    assert.equal(validateAcks({ acks: [bad] }, TODAY).valid.length, 0, JSON.stringify(bad));
});
t("a missing ack file is an empty list; a malformed one is a rejection, not a crash", () => {
  assert.deepEqual(validateAcks(undefined, TODAY), { valid: [], rejected: [] });
  assert.equal(validateAcks({ nope: 1 }, TODAY).valid.length, 0);
  assert.equal(validateAcks({ nope: 1 }, TODAY).rejected.length, 1);
});
t("an ack matches by id OR alias, case-insensitively, and by path only when it names one", () => {
  const f = { id: "GHSA-aaaa", ids: ["GHSA-aaaa", "CVE-2026-1"], path: "src/a.ts" };
  assert.ok(acked(f, [ack({ id: "cve-2026-1" })]));
  assert.ok(acked(f, [ack({ path: "src/a.ts" })]));
  assert.equal(acked(f, [ack({ path: "src/b.ts" })]), null);
  assert.equal(acked(f, [ack({ id: "GHSA-bbbb" })]), null);
});

// ---------------------------------------------------------------- deps
const F = (o) => ({ id: "GHSA-aaaa", aliases: [], dep: "x@1.0.0", severity: "high", summary: "s", malicious: false, shipped: true, lock: "pnpm-lock.yaml", ...o });
const deps = (findings, extra = {}) => ({ findings, errors: [], unsupported: [], ...extra });
const by = (vs, name) => vs.find((v) => v.name === name);

t("a shipped high blocks deps-vuln; a shipped critical too; moderate does not", () => {
  assert.equal(by(decideDeps(deps([F()]), []), "deps-vuln").status, "red");
  assert.equal(by(decideDeps(deps([F({ severity: "critical" })]), []), "deps-vuln").status, "red");
  assert.equal(by(decideDeps(deps([F({ severity: "moderate" })]), []), "deps-vuln").status, "green");
});
t("a high found ONLY in build/test tooling is a warning, never a block", () => {
  const v = by(decideDeps(deps([F({ shipped: false })]), []), "deps-vuln");
  assert.equal(v.status, "green"); assert.match(v.warnings[0], /tooling/);
});
t("a malicious package blocks deps-malicious WHEREVER it sits — shipped or tooling — and not as deps-vuln", () => {
  for (const shipped of [true, false]) {
    const vs = decideDeps(deps([F({ id: "MAL-2025-1", malicious: true, shipped })]), []);
    assert.equal(by(vs, "deps-malicious").status, "red"); assert.equal(by(vs, "deps-vuln").status, "green");
  }
});
t("isMalicious: a MAL id, a MAL alias, GitHub's malware wording — and not an ordinary advisory", () => {
  assert.ok(isMalicious({ id: "MAL-2025-9" }));
  assert.ok(isMalicious({ id: "GHSA-x", aliases: ["MAL-2022-1"] }));
  assert.ok(isMalicious({ id: "GHSA-x", summary: "Malicious Package in flatmap-stream" }));
  assert.ok(isMalicious({ id: "GHSA-x", summary: "Malware in event-stream" }));
  assert.ok(!isMalicious({ id: "GHSA-x", summary: "Prototype pollution in lodash" }));
});
t("an OSV failure (or no result) is red 'error' on BOTH checks — never green", () => {
  for (const d of [deps([], { errors: ["OSV: HTTP 503"] }), undefined]) {
    const vs = decideDeps(d, []);
    assert.deepEqual(vs.map((v) => v.status), ["error", "error"]);
  }
});
t("an ack silences exactly the finding it names, and only while valid", () => {
  const live = decideDeps(deps([F(), F({ id: "GHSA-bbbb" })]), [ack()]);
  assert.equal(by(live, "deps-vuln").blocking.length, 1); assert.equal(by(live, "deps-vuln").acknowledged.length, 1);
  assert.equal(by(decideDeps(deps([F()]), validateAcks({ acks: [ack({ expires: "2026-11-01" })] }, TODAY).valid), "deps-vuln").status, "red");
});
t("a lockfile type with no parser is NAMED as not covered", () => {
  const v = by(decideDeps(deps([], { unsupported: ["Cargo.lock"] }), []), "deps-vuln");
  assert.match(v.warnings.join(" "), /Cargo\.lock is not covered/);
});

// ---------------------------------------------------------------- sast
const sg = (severity, extra = {}) => ({ results: [{ check_id: "rule.x", path: "a.js", start: { line: 3 }, extra: { severity, message: "bad" }, ...extra }], errors: [] });
t("a Semgrep ERROR blocks; WARNING and INFO are reported only", () => {
  assert.equal(decideSast(sg("ERROR"), []).status, "red");
  const w = decideSast(sg("WARNING"), []);
  assert.equal(w.status, "green"); assert.match(w.warnings[0], /lower-severity/);
});
t("Semgrep with no JSON is red 'error' — it did not run, so nothing was checked", () => {
  assert.equal(decideSast(null, []).status, "error"); assert.equal(decideSast({}, []).status, "error");
});
t("an ack with a path covers only that file's finding", () => {
  assert.equal(decideSast(sg("ERROR"), [ack({ id: "rule.x", path: "a.js" })]).status, "green");
  assert.equal(decideSast(sg("ERROR"), [ack({ id: "rule.x", path: "b.js" })]).status, "red");
});
t("files Semgrep could not parse are said out loud", () => {
  const r = { results: [], errors: [{ level: "error", message: "Syntax error" }] };
  assert.match(decideSast(r, []).warnings[0], /could not parse/);
});

// ---------------------------------------------------------------- workflows
const zz = (severity, ident = "template-injection") => [{ ident, desc: "d", determinations: { severity }, locations: [{ symbolic: { key: { Local: { given_path: ".github/workflows/a.yml" } } }, concrete: { location: { start_point: { row: 4 } } } }] }];
t("a zizmor High blocks; Medium/Low/Informational are reported only", () => {
  assert.equal(decideWorkflows(zz("High"), []).status, "red");
  for (const s of ["Medium", "Low", "Informational"]) assert.equal(decideWorkflows(zz(s), []).status, "green", s);
});
t("zizmor with no result is red 'error'; an empty array is genuinely clean", () => {
  assert.equal(decideWorkflows(null, []).status, "error"); assert.equal(decideWorkflows([], []).status, "green");
});
t("the finding carries the file and the 1-based line", () => {
  const f = decideWorkflows(zz("High"), []).blocking[0];
  assert.equal(f.path, ".github/workflows/a.yml"); assert.equal(f.line, 5);
});

// ---------------------------------------------------------------- install
t("a package.json with no lockfile blocks; a failed frozen install blocks; ok passes", () => {
  assert.equal(decideInstall({ projects: [{ dir: "", lockfile: false }] }, []).status, "red");
  assert.equal(decideInstall({ projects: [{ dir: "", lockfile: true, frozen: "failed", detail: "out of sync" }] }, []).status, "red");
  assert.equal(decideInstall({ projects: [{ dir: "", lockfile: true, frozen: "ok" }] }, []).status, "green");
});
t("no install result is red 'error'", () => assert.equal(decideInstall(undefined, []).status, "error"));

// ---------------------------------------------------------------- the whole
t("overall: any error beats red beats green; the five checks are named", () => {
  assert.deepEqual(CHECKS, ["deps-vuln", "deps-malicious", "sast", "workflows", "install"]);
  assert.equal(overall([{ status: "green" }, { status: "red" }]), "red");
  assert.equal(overall([{ status: "red" }, { status: "error" }]), "error");
  assert.equal(overall([{ status: "green" }]), "green");
});
t("render names the check on every blocking line and lists a refused ack", () => {
  const text = render([decideSast(sg("ERROR"), [])], [{ ack: { id: "X" }, why: "expired 2026-01-01" }]);
  assert.match(text, /::error::\[sast\] rule\.x a\.js:3/);
  assert.match(text, /::error::\[ack\] X does not count: expired/);
});

// ---------------------------------------------------------------- lockfiles
t("npm: dev-only and peer-only packages are not shipped; the rest is", () => {
  const lock = { packages: { "": {}, "node_modules/a": { version: "1.0.0", resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz" }, "node_modules/d": { version: "2.0.0", dev: true, resolved: "https://registry.npmjs.org/d/-/d-2.0.0.tgz" }, "node_modules/p": { version: "3.0.0", peer: true, resolved: "https://registry.npmjs.org/p/-/p-3.0.0.tgz" } } };
  const r = parseNpm(lock);
  assert.deepEqual([...r.shipped], ["a@1.0.0"]); assert.deepEqual([...r.all].sort(), ["a@1.0.0", "d@2.0.0", "p@3.0.0"]);
});
t("pnpm: shipped follows package.json dependencies (a peer pnpm auto-installed is NOT shipped), all adds devDependencies", () => {
  const lock = {
    importers: { "packages/x": { dependencies: { a: { version: "1.0.0" }, peerish: { version: "5.0.0" } }, devDependencies: { vitest: { version: "9.0.0" } } } },
    snapshots: { "a@1.0.0": { dependencies: { b: "2.0.0" } }, "b@2.0.0": {}, "peerish@5.0.0": {}, "vitest@9.0.0": { dependencies: { c: "3.0.0" } }, "c@3.0.0": {} },
  };
  const pkg = () => ({ dependencies: { a: "^1" }, peerDependencies: { peerish: "^5" } });
  const r = parsePnpm(lock, [], pkg);
  assert.deepEqual([...r.shipped].sort(), ["a@1.0.0", "b@2.0.0"]);
  assert.deepEqual([...r.all].sort(), ["a@1.0.0", "b@2.0.0", "c@3.0.0", "peerish@5.0.0", "vitest@9.0.0"]);
});
t("pnpm: a skipped importer (examples/) contributes nothing", () => {
  const lock = { importers: { "examples/e": { dependencies: { a: { version: "1.0.0" } } }, "packages/x": { dependencies: { b: { version: "2.0.0" } } } }, snapshots: { "a@1.0.0": {}, "b@2.0.0": {} } };
  assert.deepEqual([...parsePnpm(lock, ["examples/"]).shipped], ["b@2.0.0"]);
});
t("bun: workspace dependencies resolve through nested keys; devDependencies are not shipped", () => {
  const lock = parseJsonc(`{
    "lockfileVersion": 1,
    "workspaces": { "": { "name": "r", "dependencies": { "a": "^1" }, "devDependencies": { "t": "^1" } } },
    "packages": {
      "a": ["a@1.0.0", "", { "dependencies": { "b": "^2" } }, "sha512-x"],
      "a/b": ["b@2.0.0", "", {}, "sha512-y"],
      "b": ["b@1.0.0", "", {}, "sha512-z"],
      "t": ["t@1.0.0", "", { "dependencies": { "b": "^1" } }, "sha512-w"],
    }
  }`);
  const r = parseBun(lock);
  assert.deepEqual([...r.shipped].sort(), ["a@1.0.0", "b@2.0.0"]);
  assert.deepEqual([...r.all].sort(), ["a@1.0.0", "b@1.0.0", "b@2.0.0", "t@1.0.0"]);
});
t("JSONC: comments and trailing commas are read, a // inside a string is kept", () =>
  assert.deepEqual(parseJsonc('{ "a": "http://x", /* c */ "b": [1,2,], // t\n }'), { a: "http://x", b: [1, 2] }));
t("findLockfiles: finds supported and NAMES unsupported ones, skips node_modules and excluded prefixes", () => {
  const d = mkdtempSync(join(tmpdir(), "lf-"));
  for (const p of ["pnpm-lock.yaml", "sub/bun.lock", "sub/Cargo.lock", "node_modules/x/package-lock.json", "fx/yarn.lock", "security-gate/fixtures/c/package-lock.json"]) {
    mkdirSync(join(d, p, ".."), { recursive: true }); writeFileSync(join(d, p), "");
  }
  const got = findLockfiles(d, ["security-gate/fixtures/"]).map((l) => `${l.path}:${l.supported}`);
  assert.deepEqual(got, ["fx/yarn.lock:false", "pnpm-lock.yaml:true", "sub/bun.lock:true", "sub/Cargo.lock:false"]);
});

// ---------------------------------------------------------------- a tool that did not run is NOT a clean result
const fakeTool = (stdout) => {
  const d = mkdtempSync(join(tmpdir(), "fake-tool-"));
  const f = join(d, "tool");
  writeFileSync(f, `#!/bin/sh\nprintf '%s' '${stdout}'\n`);
  chmodSync(f, 0o755);
  return f;
};
const withWorkflows = () => { const d = mkdtempSync(join(tmpdir(), "wf-")); mkdirSync(join(d, ".github", "workflows"), { recursive: true }); return d; };
t("zizmor that prints NOTHING is null (could not check) — the selftest caught the engine reading it as zero findings", () => {
  process.env.ZIZMOR_BIN = fakeTool("");
  assert.equal(runZizmor(withWorkflows()), null);
});
t("zizmor that prints garbage is null; one that prints [] is a genuinely clean []", () => {
  process.env.ZIZMOR_BIN = fakeTool("not json");
  assert.equal(runZizmor(withWorkflows()), null);
  process.env.ZIZMOR_BIN = fakeTool("[]");
  assert.deepEqual(runZizmor(withWorkflows()), []);
});
t("zizmor that cannot even be started is null", () => {
  process.env.ZIZMOR_BIN = "/no/such/zizmor";
  assert.equal(runZizmor(withWorkflows()), null);
});
t("a repo without .github/workflows has nothing to harden: [] (a fact, not a failure)", () => {
  process.env.ZIZMOR_BIN = "/no/such/zizmor";
  assert.deepEqual(runZizmor(mkdtempSync(join(tmpdir(), "nowf-"))), []);
});
t("Semgrep that prints nothing, garbage, or cannot start is null", () => {
  for (const bin of [fakeTool(""), fakeTool("not json"), "/no/such/semgrep"]) { process.env.SEMGREP_BIN = bin; assert.equal(runSemgrep(mkdtempSync(join(tmpdir(), "sg-")), []), null); }
});
t("Semgrep that prints a result object is passed through", () => {
  process.env.SEMGREP_BIN = fakeTool('{"results":[],"errors":[]}');
  assert.deepEqual(runSemgrep(mkdtempSync(join(tmpdir(), "sg-")), []), { results: [], errors: [] });
});
console.log(`\n${n} passed`);

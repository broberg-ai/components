#!/usr/bin/env node
// F427.1 — the fleet security gate's decisions: every rule, both directions. Pure — no network, no tool.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHECKS, MAX_ACK_DAYS, validateAcks, acked, isMalicious, decideDeps, decideSast, decideWorkflows, decideInstall, overall, render,
} from "./security-gate/decide.mjs";
import { parsePnpm, parseNpm, parseBun, parseJsonc, findLockfiles, readLockfile } from "./security-gate/lockfiles.mjs";
import { parseGateConfig } from "./security-gate/config.mjs";
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
t("a lockfile with no parser BLOCKS deps-vuln (its dependencies were not checked); an ack by id+path with a date lets a human accept it", () => {
  const v = by(decideDeps(deps([], { unsupported: ["Cargo.lock"] }), []), "deps-vuln");
  assert.equal(v.status, "red"); assert.equal(v.blocking[0].id, "unsupported-lockfile"); assert.equal(v.blocking[0].path, "Cargo.lock");
  assert.equal(by(decideDeps(deps([], { unsupported: ["Cargo.lock"] }), [ack({ id: "unsupported-lockfile", path: "Cargo.lock" })]), "deps-vuln").status, "green");
  assert.equal(by(decideDeps(deps([], { unsupported: ["Cargo.lock"] }), [ack({ id: "unsupported-lockfile", path: "go.sum" })]), "deps-vuln").status, "red");
});


// ---------------------------------------------------------------- sast
const sg = (severity, extra = {}) => ({ json: { results: [{ check_id: "rule.x", path: "a.js", start: { line: 3 }, extra: { severity, message: "bad" }, ...extra }], errors: [] }, status: 0 });
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
t("EXIT 7 (an unreachable or invalid rule pack) with EMPTY results is 'error', never green — cardmem's review found this fail-open", () => {
  const bad = { json: { results: [], errors: [{ level: "error", type: "SemgrepError", code: 2, message: "Failed to download configuration from https://semgrep.dev/c/p/x HTTP 404." }, { level: "error", code: 7, message: "invalid configuration file found (1 configs were invalid)" }] }, status: 7 };
  const v = decideSast(bad, []);
  assert.equal(v.status, "error"); assert.match(v.errors[0], /exited 7.*HTTP 404/);
  for (const status of [1, 2, 3, 7, 124]) assert.equal(decideSast({ json: { results: [], errors: [] }, status }, []).status, "error", `exit ${status}`);
});
t("a file Semgrep could not parse BLOCKS (it was not analysed); a warn-level note does not; an ack by id+path silences it", () => {
  const err = (level) => ({ json: { results: [], errors: [{ level, type: "Syntax error", message: "Syntax error at line 3", path: "src/a.js", spans: [{ file: "src/a.js", start: { line: 3 } }] }] }, status: 0 });
  const v = decideSast(err("error"), []);
  assert.equal(v.status, "red"); assert.equal(v.blocking[0].id, "semgrep-error"); assert.equal(v.blocking[0].path, "src/a.js");
  assert.equal(decideSast(err("warn"), []).status, "green");
  assert.equal(decideSast(err("error"), [ack({ id: "semgrep-error", path: "src/a.js" })]).status, "green");
  assert.equal(decideSast(err("error"), [ack({ id: "semgrep-error", path: "src/b.js" })]).status, "red");
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
t("a swallowing pipe step blocks `workflows` even when zizmor is clean; an ack by id+path silences it", () => {
  const pipe = { id: "pipe-swallows-failure", path: ".github/workflows/ci.yml", summary: "test › gate: pipes into tee without pipefail" };
  assert.equal(decideWorkflows([], [], [pipe]).status, "red");
  assert.equal(decideWorkflows([], [ack({ id: "pipe-swallows-failure", path: ".github/workflows/ci.yml" })], [pipe]).status, "green");
  assert.equal(decideWorkflows([], [ack({ id: "pipe-swallows-failure", path: ".github/workflows/other.yml" })], [pipe]).status, "red");
});
t("unreadable workflow files (pipes = null) are 'error', never clean", () => assert.equal(decideWorkflows([], [], null).status, "error"));
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
const fakeTool = (stdout, code = 0) => {
  const d = mkdtempSync(join(tmpdir(), "fake-tool-"));
  const f = join(d, "tool");
  writeFileSync(f, `#!/bin/sh\nprintf '%s' '${stdout}'\nexit ${code}\n`);
  chmodSync(f, 0o755);
  return f;
};
const withWorkflows = () => { const d = mkdtempSync(join(tmpdir(), "wf-")); mkdirSync(join(d, ".github", "workflows"), { recursive: true }); writeFileSync(join(d, ".github", "workflows", "ci.yml"), "name: ci\non: [push]\njobs: {}\n"); return d; };
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
t("--exclude is honoured by zizmor: excluded workflow files are never handed to it, and nothing left means nothing to harden", () => {
  process.env.ZIZMOR_BIN = "/no/such/zizmor"; // would make runZizmor null if it were called
  const d = withWorkflows(); writeFileSync(join(d, ".github", "workflows", "old.yml"), "name: old\non: [push]\njobs: {}\n");
  assert.equal(runZizmor(d, [".github/workflows/old.yml"]), null); // ci.yml is still handed over → the missing binary is «could not check»
  assert.deepEqual(runZizmor(d, [".github/workflows/old.yml", ".github/workflows/ci.yml"]), []);
  assert.equal(runZizmor(d, []), null); // not excluded → zizmor IS called → cannot start → null
});
t("SECURITY_GATE_PACKS replaces the rule packs handed to Semgrep (the selftest uses it to plant an invalid pack)", () => {
  const d = mkdtempSync(join(tmpdir(), "args-"));
  const f = join(d, "tool"); writeFileSync(f, `#!/bin/sh\nprintf '{"results":[],"errors":[],"args":"%s"}' "$*"\n`); chmodSync(f, 0o755);
  process.env.SEMGREP_BIN = f; process.env.SECURITY_GATE_PACKS = "p/does-not-exist, p/second";
  const args = runSemgrep(d, []).json.args;
  delete process.env.SECURITY_GATE_PACKS;
  assert.match(args, /--config p\/does-not-exist --config p\/second/); assert.doesNotMatch(args, /p\/security-audit/);
});
t("a repo without .github/workflows has nothing to harden: [] (a fact, not a failure)", () => {
  process.env.ZIZMOR_BIN = "/no/such/zizmor";
  assert.deepEqual(runZizmor(mkdtempSync(join(tmpdir(), "nowf-"))), []);
});
t("Semgrep that prints nothing, garbage, or cannot start is null", () => {
  for (const bin of [fakeTool(""), fakeTool("not json"), "/no/such/semgrep"]) { process.env.SEMGREP_BIN = bin; assert.equal(runSemgrep(mkdtempSync(join(tmpdir(), "sg-")), []), null); }
});
t("Semgrep that prints a result object is passed through WITH its exit status", () => {
  process.env.SEMGREP_BIN = fakeTool('{"results":[],"errors":[]}');
  assert.deepEqual(runSemgrep(mkdtempSync(join(tmpdir(), "sg-")), []), { json: { results: [], errors: [] }, status: 0 });
  process.env.SEMGREP_BIN = fakeTool('{"results":[],"errors":[{"level":"error","code":7,"message":"invalid configuration file found"}]}', 7);
  const r = runSemgrep(mkdtempSync(join(tmpdir(), "sg-")), []);
  assert.equal(r.status, 7); assert.equal(decideSast(r, []).status, "error");
});

// ---------------------------------------------------------------- the runner's wiring (not just the pure decisions)
const RUN_CHECK = join(dirname(fileURLToPath(import.meta.url)), "security-gate", "run-check.mjs");
const workflowDir = (step) => {
  const d = mkdtempSync(join(tmpdir(), "wf-run-"));
  mkdirSync(join(d, ".github", "workflows"), { recursive: true });
  writeFileSync(join(d, ".github", "workflows", "ci.yml"), `name: ci\non: [push]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${step}\n`);
  return d;
};
const runWorkflows = (dir) => {
  const r = spawnSync("node", [RUN_CHECK, "workflows", "--dir", dir, "--exclude", ""], { encoding: "utf8", env: { ...process.env, ZIZMOR_BIN: fakeTool("[]") } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
t("run-check `workflows`: a step that pipes a check into tee is RED by name even when zizmor finds nothing", () => {
  const r = runWorkflows(workflowDir("node check.mjs | tee out"));
  assert.equal(r.code, 1); assert.match(r.out, /::error::\[workflows\] pipe-swallows-failure \.github\/workflows\/ci\.yml/);
});
t("run-check `workflows`: the same step with pipefail, or no pipe at all, is green", () => {
  assert.equal(runWorkflows(workflowDir("set -o pipefail; node check.mjs | tee out")).code, 0);
  assert.equal(runWorkflows(workflowDir("node check.mjs")).code, 0);
});

// ---------------------------------------------------------------- per-repo config: an exception, never an off switch
t("config: a path with a real reason is accepted and is PRINTED (notes); no file means no exclusions", () => {
  const c = parseGateConfig({ exclude: [{ path: "vendor/", reason: "vendored upstream code" }], skipImporters: [{ path: "examples", reason: "demo apps no one installs" }], sastExclude: [{ path: "docs/", reason: "generated documentation" }] });
  assert.deepEqual([c.exclude, c.skipImporters, c.sastExclude, c.errors], [["vendor/"], ["examples"], ["docs/"], []]);
  assert.equal(c.notes.length, 3); assert.match(c.notes[0], /exclude: vendor\/ — vendored upstream code/);
  assert.deepEqual(parseGateConfig(undefined), { exclude: [], skipImporters: [], sastExclude: [], notes: [], errors: [] });
});
t("config: no reason, a short reason, a missing path: each refused", () => {
  for (const e of [{ path: "vendor/" }, { path: "vendor/", reason: "short" }, { reason: "a perfectly fine reason" }, { path: "  ", reason: "a perfectly fine reason" }])
    assert.equal(parseGateConfig({ exclude: [e] }).errors.length, 1, JSON.stringify(e));
});
t("config: the repo root, the workflows, globs and paths outside the repo can NEVER be excluded", () => {
  for (const path of ["", ".", "./", "/", ".github", ".github/workflows", "*", "**", "src/*", "../up", "/abs/path"])
    assert.ok(parseGateConfig({ exclude: [{ path, reason: "a perfectly fine reason" }] }).errors.some((m) => /can never be excluded/.test(m)), path);
});
t("config: an unknown key (a typo that would silently exclude nothing) and a non-object are refused", () => {
  assert.match(parseGateConfig({ excludes: [] }).errors[0], /unknown key «excludes»/);
  assert.equal(parseGateConfig([]).errors.length, 1); assert.equal(parseGateConfig("x").errors.length, 1);
  assert.equal(parseGateConfig({ exclude: "vendor" }).errors.length, 1);
});
t("run-check: a bad .github/security-gate.json makes the run RED by name [config], before any tool starts", () => {
  const d = mkdtempSync(join(tmpdir(), "cfg-")); mkdirSync(join(d, ".github"), { recursive: true });
  writeFileSync(join(d, ".github", "security-gate.json"), JSON.stringify({ exclude: [{ path: ".github", reason: "switch the workflows off" }] }));
  const r = spawnSync("node", [RUN_CHECK, "install", "--dir", d], { encoding: "utf8" });
  assert.equal(r.status, 1); assert.match(r.stdout, /::error::\[config\] .*can never be excluded/);
  writeFileSync(join(d, ".github", "security-gate.json"), "{not json");
  assert.match(spawnSync("node", [RUN_CHECK, "install", "--dir", d], { encoding: "utf8" }).stdout, /::error::\[config\] .* is not JSON/);
});
t("run-check: the config's exclusion REACHES the checks (a vendored project with no lockfile is red — until it is excluded with a reason)", () => {
  const d = mkdtempSync(join(tmpdir(), "cfg-ex-")); mkdirSync(join(d, "vendor"), { recursive: true }); mkdirSync(join(d, ".github"), { recursive: true });
  writeFileSync(join(d, "vendor", "package.json"), '{"name":"v","version":"1.0.0"}');
  const run = () => spawnSync("node", [RUN_CHECK, "install", "--dir", d], { encoding: "utf8" });
  assert.equal(run().status, 1);
  writeFileSync(join(d, ".github", "security-gate.json"), JSON.stringify({ exclude: [{ path: "vendor/", reason: "vendored code, reviewed on import" }] }));
  const r = run();
  assert.equal(r.status, 0); assert.match(r.stdout, /::notice::\[config\] excluded from the gate — exclude: vendor\//);
});
t("Semgrep: only bare names go to --exclude; path-style exclusions filter the FINDINGS by relative path — even when the checkout's own absolute path contains the excluded prefix", () => {
  // The trap: Semgrep matches --exclude against the ABSOLUTE path, so `security-gate/fixtures` excluded the selftest's own target.
  const root = mkdtempSync(join(tmpdir(), "sgf-")); const target = join(root, "security-gate", "fixtures", "app"); mkdirSync(target, { recursive: true });
  const f = join(root, "tool");
  writeFileSync(f, `#!/bin/sh\nprintf '{"results":[{"check_id":"r","path":"server.js","extra":{"severity":"ERROR"}},{"check_id":"r","path":"vendor/x.js","extra":{"severity":"ERROR"}},{"check_id":"r","path":"security-gate/fixtures/c/y.js","extra":{"severity":"ERROR"}}],"errors":[{"level":"error","path":"vendor/z.js","message":"m"}],"args":"%s"}' "$*"\n`); chmodSync(f, 0o755);
  process.env.SEMGREP_BIN = f;
  const out = runSemgrep(target, ["security-gate/fixtures", "vendor/"]).json;
  assert.match(out.args, /--exclude node_modules --exclude \.git \.$/); assert.doesNotMatch(out.args, /vendor|fixtures/);
  assert.deepEqual(out.results.map((r) => r.path), ["server.js"]); assert.equal(out.errors.length, 0);
});
t("Semgrep: dist/build/coverage are filtered by path COMPONENT, not by substring (a file named distinct.js is kept)", () => {
  const root = mkdtempSync(join(tmpdir(), "sgd-")); const f = join(root, "tool");
  writeFileSync(f, `#!/bin/sh\nprintf '{"results":[{"check_id":"r","path":"dist/a.js","extra":{"severity":"ERROR"}},{"check_id":"r","path":"src/distinct.js","extra":{"severity":"ERROR"}},{"check_id":"r","path":"src/dist/b.js","extra":{"severity":"ERROR"}}],"errors":[]}'\n`); chmodSync(f, 0o755);
  process.env.SEMGREP_BIN = f;
  assert.deepEqual(runSemgrep(root, []).json.results.map((r) => r.path), ["src/distinct.js"]);
  assert.deepEqual(runSemgrep(root, ["src/dist"]).json.results.length, 1); // a configured exclusion is a PREFIX from the root: «vendor» does not hide src/vendor/x.js
});
t("pnpm 11/12 lockfile: TWO YAML documents are both read (parse() refuses them: «Source contains multiple documents»)", () => {
  const d = mkdtempSync(join(tmpdir(), "pn2-")); writeFileSync(join(d, "pnpm-lock.yaml"), "x");
  const docs = [
    { importers: { ".": { dependencies: { a: { version: "1.0.0" } } } }, snapshots: { "a@1.0.0": {} } },
    { importers: { ".": { devDependencies: { b: { version: "2.0.0" } } } }, snapshots: { "b@2.0.0": {} } },
  ];
  const r = readLockfile(d, { path: "pnpm-lock.yaml", kind: "pnpm" }, () => docs);
  assert.deepEqual([...r.shipped], ["a@1.0.0"]); assert.deepEqual([...r.all].sort(), ["a@1.0.0", "b@2.0.0"]);
  assert.throws(() => readLockfile(d, { path: "pnpm-lock.yaml", kind: "pnpm" }, () => []), /no readable YAML document/);
  assert.deepEqual([...readLockfile(d, { path: "pnpm-lock.yaml", kind: "pnpm" }, () => docs[0]).shipped], ["a@1.0.0"]); // a single document still works
});


console.log(`\n${n} passed`);

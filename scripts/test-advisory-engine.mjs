#!/usr/bin/env node
// F082.10 — the shared advisory watch's decisions (scripts/advisory/engine.mjs).
// Each case is one of bid's requirements (#4318) or BID's production behaviour.
import assert from "node:assert/strict";
import { detectPm, parseAudit, lockedFromLockfile, validateAck, decide, planAlarm, issueTitle, ERROR_ID } from "./advisory/engine.mjs";

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

console.log(`\nadvisory engine: ${n} checks passed`);

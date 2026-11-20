#!/usr/bin/env node
// F115.1 — the release gate must be able to go red, and must not be silenceable by accident.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideRelease } from "./check-release-advisories.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const z = () => ({ critical: 0, high: 0, moderate: 0, low: 0 });
const row = (o = {}) => ({ status: "ok", prod: z(), peer: z(), dev: z(), osv: { status: "ok", findings: [] }, ...o });
const res = (packages) => ({ packages });

t("a clean tree is clean", () => assert.equal(decideRelease(res({ "@broberg/a": row() })).status, "clean"));
t("a high in what ships blocks", () => {
  const r = decideRelease(res({ "@broberg/a": row({ prod: { ...z(), high: 1 } }) }));
  assert.equal(r.status, "blocking"); assert.equal(r.blocking[0].pkg, "@broberg/a");
});
t("a critical OSV finding blocks, a moderate one does not", () => {
  const f = (severity) => ({ id: "GHSA-x", severity, title: "t" });
  assert.equal(decideRelease(res({ p: row({ osv: { status: "ok", findings: [f("critical")] } }) })).status, "blocking");
  assert.equal(decideRelease(res({ p: row({ osv: { status: "ok", findings: [f("moderate")] } }) })).status, "clean");
});
t("dev findings never block a release", () =>
  assert.equal(decideRelease(res({ p: row({ dev: { ...z(), critical: 9 } }) })).status, "clean"));
t("peer findings warn, never block", () => {
  const r = decideRelease(res({ p: row({ peer: { ...z(), critical: 2 } }) }));
  assert.equal(r.status, "clean"); assert.equal(r.warnings.length, 1);
});
t("could-not-check is red, never clean (package and OSV)", () => {
  assert.equal(decideRelease(res({ p: row({ status: "error", error: "boom" }) })).status, "error");
  assert.equal(decideRelease(res({ p: row({ osv: { status: "error", error: "net" } }) })).status, "error");
});
t("a failed `pnpm outdated` alone warns; a failed audit is red", () => {
  const out = decideRelease(res({ p: row({ status: "error", error: "pnpm outdated --format json failed: Command failed: pnpm outdated --format json" }) }));
  assert.equal(out.status, "clean"); assert.equal(out.warnings.length, 1);
  assert.equal(decideRelease(res({ p: row({ status: "error", error: "pnpm audit failed" }) })).status, "error");
  assert.equal(decideRelease(res({ p: row({ status: "error", error: "pnpm audit failed · pnpm outdated failed" }) })).status, "error");
});
t("an empty or missing result is red", () => {
  assert.equal(decideRelease({}).status, "error"); assert.equal(decideRelease(res({})).status, "error");
});
t("an acknowledgement needs a reason", () =>
  assert.equal(decideRelease(res({ p: row({ prod: { ...z(), high: 1 } }) }), { p: { prod: { high: 1 } } }).status, "blocking"));
t("an acknowledgement is bounded: one more finding is red again", () => {
  const ack = { p: { reason: "unreachable: x", prod: { high: 1 } } };
  assert.equal(decideRelease(res({ p: row({ prod: { ...z(), high: 1 } }) }), ack).status, "clean");
  assert.equal(decideRelease(res({ p: row({ prod: { ...z(), high: 2 } }) }), ack).status, "blocking");
});
t("an acknowledged OSV id passes, another id does not", () => {
  const f = (id) => ({ id, severity: "high", title: "t" });
  const ack = { p: { reason: "unreachable", ids: ["GHSA-a"] } };
  assert.equal(decideRelease(res({ p: row({ osv: { status: "ok", findings: [f("GHSA-a")] } }) }), ack).status, "clean");
  assert.equal(decideRelease(res({ p: row({ osv: { status: "ok", findings: [f("GHSA-b")] } }) }), ack).status, "blocking");
});
t("the CLI exits 1 on a finding and 0 when clean", () => {
  const d = mkdtempSync(join(tmpdir(), "reladv-"));
  const bad = join(d, "bad.json"), ok = join(d, "ok.json");
  writeFileSync(bad, JSON.stringify(res({ p: row({ prod: { ...z(), critical: 1 } }) })));
  writeFileSync(ok, JSON.stringify(res({ p: row() })));
  const run = (f) => { try { execFileSync("node", ["scripts/check-release-advisories.mjs", "--in", f, "--ack", join(d, "none.json")], { stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
  assert.equal(run(bad), 1); assert.equal(run(ok), 0);
});
console.log(`\n${n} passed`);

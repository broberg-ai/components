#!/usr/bin/env node
// F115.1 — the release gate on what a package SHIPS.
//
//   node scripts/dependency-health.mjs --out dh.json
//   node scripts/check-release-advisories.mjs --in dh.json [--ack .github/advisory-ack.json]
//
// WHY THIS AND NOT THE WHOLE-LOCKFILE ADVISORY GATE. Measured 20/11 2026: the
// shared advisory gate (scripts/advisory/watch.mjs --mode gate) on this workspace's
// lockfile is red on 53 high/critical findings, nearly all in build/test tooling
// (vitest, example apps) that never reaches a consumer. Wiring that in would block
// every release for holes no consumer installs, and the answer would be to silence
// it — the exact failure this gate must not have. The dependency-health measurement
// already separates what a package SHIPS (prod = dependencies, plus OSV over the
// locked tree it ships) from what only builds it. THAT is what blocks a release.
// The workspace-wide picture stays visible and acted on (advisory-watch issues,
// Dependabot), it just does not decide a release.
//
// RULES
//   · high/critical in `prod` or in OSV findings of what ships  → red
//   · a row that could not be checked (status/osv not "ok")        → red, never clean
//   · `peer` findings are reported as warnings: the consumer picks the peer version
//   · an acknowledgement is bounded and reasoned, never a silenced rule:
//       { "<pkg>": { "reason": "…", "prod": { "critical": 0, "high": 1 }, "ids": ["GHSA-…"] } }
//     `prod` allows UP TO those counts (one more finding is red again); `ids` lets
//     named OSV findings through. No reason → the entry is ignored.
import { readFileSync, existsSync } from "node:fs";

export const BLOCKING = ["critical", "high"];

export function decideRelease(result, ack = {}) {
  const blocking = [], acknowledged = [], errors = [], warnings = [];
  const packages = result?.packages;
  if (!packages || Object.keys(packages).length === 0) {
    return { status: "error", blocking, acknowledged, warnings, errors: ["no packages in the dependency-health result — nothing was checked"] };
  }
  for (const [name, row] of Object.entries(packages)) {
    // `pnpm outdated` is about freshness, not security: its failure (a registry blip)
    // must not block a release. Anything else that makes the row non-ok (audit,
    // lockfile) means we could not look at the vulnerabilities — red.
    const securityError = row.status !== "ok" && !/^pnpm outdated[^·]*$/.test(row.error ?? "");
    if (securityError) errors.push(`${name}: could not check (${row.error ?? row.status})`);
    else if (row.status !== "ok") warnings.push(`${name}: freshness check failed (${row.error})`);
    if (row.osv?.status !== "ok") errors.push(`${name}: OSV could not check (${row.osv?.error ?? row.osv?.status ?? "no osv result"})`);
    const a = ack[name] && typeof ack[name].reason === "string" && ack[name].reason.trim() ? ack[name] : null;
    for (const sev of BLOCKING) {
      const n = row.prod?.[sev] ?? 0;
      if (n === 0) continue;
      const allowed = a?.prod?.[sev] ?? 0;
      (n <= allowed ? acknowledged : blocking).push({ pkg: name, kind: "prod", severity: sev, count: n, allowed, reason: a?.reason });
    }
    for (const f of row.osv?.findings ?? []) {
      if (!BLOCKING.includes(f.severity)) continue;
      const ok = a?.ids?.includes(f.id);
      (ok ? acknowledged : blocking).push({ pkg: name, kind: "osv", severity: f.severity, id: f.id, title: f.title, reason: a?.reason });
    }
    for (const sev of BLOCKING) {
      const n = row.peer?.[sev] ?? 0;
      if (n) warnings.push(`${name}: ${n} ${sev} in the peer range it resolves in this workspace (consumer chooses its own version)`);
    }
  }
  const status = errors.length ? "error" : blocking.length ? "blocking" : "clean";
  return { status, blocking, acknowledged, warnings, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const inPath = arg("in", "data/dependency-health.json");
  const ackPath = arg("ack", ".github/advisory-ack.json");
  let result, ack = {};
  try { result = JSON.parse(readFileSync(inPath, "utf8")); }
  catch (e) { console.log(`::error::cannot read ${inPath}: ${e.message}`); process.exit(1); }
  if (existsSync(ackPath)) {
    try { ack = JSON.parse(readFileSync(ackPath, "utf8")); }
    catch (e) { console.log(`::error::${ackPath} is not JSON: ${e.message}`); process.exit(1); }
  }
  const r = decideRelease(result, ack);
  const n = Object.keys(result.packages ?? {}).length;
  console.log(`release advisories: ${n} packages · ${r.status} · blocking ${r.blocking.length} · acknowledged ${r.acknowledged.length} · errors ${r.errors.length}`);
  for (const e of r.errors) console.log(`::error::${e}`);
  for (const f of r.blocking) console.log(`::error::${f.pkg} ships ${f.kind === "osv" ? `${f.severity} ${f.id} — ${f.title}` : `${f.count} ${f.severity} (acknowledged up to ${f.allowed})`}`);
  for (const f of r.acknowledged) console.log(`  acknowledged ${f.pkg} ${f.id ?? f.severity}: ${f.reason}`);
  for (const w of r.warnings) console.log(`::warning::${w}`);
  process.exit(r.status === "clean" ? 0 : 1);
}

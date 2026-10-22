#!/usr/bin/env node
// F082.5 — are the dependencies of every published @broberg package OK?
//
//   node scripts/dependency-health.mjs [--out data/dependency-health.json]
//
// Christian 23/10 2026: «Kører du nogle CI / Cronjobs for at checke om alle
// vores dependencies er OK for samtlige pakker? Det skal du også gøre.» Measured
// that evening: nothing did. This runs weekly in CI (.github/workflows/
// dependency-health.yml) and writes one row per package.
//
// Two questions per package, kept apart:
//   vulns     — known vulnerabilities, split into what SHIPS to the apps that
//               install the package (prod) and what only its own build/test
//               tooling uses (dev). Only prod reaches a consumer.
//   outdated  — direct dependencies behind npm's latest, and how many of those
//               the package actually ships (dependencies/peerDependencies).
//
// «No findings» and «could not check» are different results: a check that did
// not run carries status "error" with the reason, never zeroes.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const SEVERITIES = ["critical", "high", "moderate", "low"];
const zero = () => ({ critical: 0, high: 0, moderate: 0, low: 0 });

/** `pnpm audit --json` → { "<importer dir>": { critical, high, moderate, low } }.
 *  A finding's path starts with the importer, e.g. "packages__auth>better-auth>…". */
export function summarizeAudit(audit) {
  const by = {};
  for (const a of Object.values(audit?.advisories ?? {})) {
    if (!SEVERITIES.includes(a.severity)) continue;
    // Count an advisory ONCE per importer, however many paths lead to it.
    const importers = new Set();
    for (const f of a.findings ?? []) for (const p of f.paths ?? []) importers.add(String(p).split(">")[0].replace(/__/g, "/"));
    for (const imp of importers) (by[imp] ??= zero())[a.severity]++;
  }
  return by;
}

/** `pnpm outdated --format json` for one package → counts. */
export function summarizeOutdated(outdated) {
  const rows = Object.values(outdated ?? {});
  return {
    total: rows.length,
    shipped: rows.filter((r) => r.dependencyType === "dependencies" || r.dependencyType === "peerDependencies").length,
    deprecated: rows.filter((r) => r.isDeprecated).length,
  };
}

/** The verdict a human reads first. */
export function verdict(row) {
  if (row.status === "error") return "kunne ikke tjekke";
  if (row.prod.critical || row.prod.high) return "sårbar";
  if (row.prod.moderate || row.prod.low) return "mindre fund";
  return "OK";
}

/** F082.5 — the findings that must become a card: high/critical in what SHIPS. */
export function findingsToCard(result) {
  return Object.entries(result?.packages ?? {})
    .filter(([, r]) => r.status !== "error" && (r.prod.critical > 0 || r.prod.high > 0))
    .map(([name, r]) => ({
      title: `${name}: ${r.prod.critical} kritiske og ${r.prod.high} høje sårbarheder i det pakken leverer`,
      body: `Ugentligt afhængigheds-tjek (F082.5) ${result.checked_at}: ${name} v${r.version} — prod: kritisk ${r.prod.critical}, høj ${r.prod.high}, middel ${r.prod.moderate}, lav ${r.prod.low}. Kør \`pnpm audit --prod\` i packages/${name.replace("@broberg/", "")} for detaljer.`,
    }));
}

/** Run a command whose JSON goes to stdout even when it exits non-zero (audit/outdated do). */
function runJson(cmd, args, cwd) {
  try {
    return JSON.parse(execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64e6, stdio: ["ignore", "pipe", "pipe"] }) || "{}");
  } catch (e) {
    if (e && typeof e.stdout === "string" && e.stdout.trim().startsWith("{")) return JSON.parse(e.stdout);
    throw new Error(`${cmd} ${args.join(" ")} failed: ${String(e?.stderr || e?.message || e).split("\n")[0].slice(0, 200)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL("..", import.meta.url).pathname;
  const outIdx = process.argv.indexOf("--out");
  const out = outIdx > 0 ? process.argv[outIdx + 1] : null;

  const pkgs = readdirSync(`${root}packages`)
    .map((d) => ({ dir: `packages/${d}`, file: `${root}packages/${d}/package.json` }))
    .filter((p) => existsSync(p.file))
    .map((p) => ({ ...p, json: JSON.parse(readFileSync(p.file, "utf8")) }))
    .filter((p) => String(p.json.name ?? "").startsWith("@broberg/") && !p.json.private);

  let prod = null, all = null, auditError = null;
  try {
    prod = summarizeAudit(runJson("pnpm", ["audit", "--prod", "--json"], root));
    all = summarizeAudit(runJson("pnpm", ["audit", "--json"], root));
  } catch (e) {
    auditError = e.message;
  }

  const packages = {};
  for (const p of pkgs) {
    const row = { version: p.json.version, status: "ok", prod: zero(), dev: zero(), outdated: { total: 0, shipped: 0, deprecated: 0 } };
    if (auditError) { row.status = "error"; row.error = auditError; }
    else {
      row.prod = prod[p.dir] ?? zero();
      const a = all[p.dir] ?? zero();
      // dev = everything the full audit found minus what ships.
      row.dev = Object.fromEntries(SEVERITIES.map((s) => [s, Math.max(0, a[s] - row.prod[s])]));
    }
    try {
      row.outdated = summarizeOutdated(runJson("pnpm", ["outdated", "--format", "json"], `${root}${p.dir}`));
    } catch (e) {
      row.status = "error";
      row.error = [row.error, e.message].filter(Boolean).join(" · ");
    }
    row.verdict = verdict(row);
    packages[p.json.name] = row;
    console.error(`${p.json.name.padEnd(34)} ${row.verdict.padEnd(16)} prod c${row.prod.critical} h${row.prod.high} m${row.prod.moderate} · outdated ${row.outdated.total} (${row.outdated.shipped} shipped)`);
  }

  const result = { checked_at: new Date().toISOString(), packages };
  const json = JSON.stringify(result, null, 1) + "\n";
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
  // A run where NOTHING could be checked is a failed run, not a clean fleet.
  if (Object.values(packages).every((r) => r.status === "error")) process.exit(1);
}

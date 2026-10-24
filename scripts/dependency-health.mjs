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
 *  A finding's path starts with the importer, e.g. "packages__auth>better-auth>…".
 *  `counts(importer, directDep)` decides which paths count; default all.
 *  @param {any} audit @param {(importer: string, directDep: string) => boolean} [counts] */
export function summarizeAudit(audit, counts = () => true) {
  const by = {};
  for (const a of Object.values(audit?.advisories ?? {})) {
    if (!SEVERITIES.includes(a.severity)) continue;
    // Count an advisory ONCE per importer, however many paths lead to it.
    const importers = new Set();
    for (const f of a.findings ?? []) for (const p of f.paths ?? []) {
      const [imp, dep] = String(p).split(">");
      const dir = imp.replace(/__/g, "/");
      if (counts(dir, dep)) importers.add(dir);
    }
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
  if (row.status === "error" || row.osv?.status === "error") return "kunne ikke tjekke";
  const o = row.osv ?? zero();
  if (row.prod.critical || row.prod.high || o.critical || o.high) return "sårbar";
  if (row.prod.moderate || row.prod.low || o.moderate || o.low || o.unrated) return "mindre fund";
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

// ── F082.9 — OSV.dev, daily ──────────────────────────────────────────────────
// pnpm audit reads one database (npm's). OSV.dev adds OpenSSF's malicious-package
// reports (MAL-*) and is where BID's daily check found zod (GHSA-mrhx-c7xc-m3w5).
// CISA KEV marks the holes that are being exploited right now.

/** Every locked name@version a package SHIPS: walked from its `dependencies` in
 *  pnpm-lock.yaml (v9). A workspace link ships the linked package's own
 *  dependencies. Peers are the app's install, not ours (see the audit note below).
 *  @param {any} lock @param {string} dir @param {Iterable<string>} shippedNames */
export function lockedShipped(lock, dir, shippedNames) {
  const out = new Set();
  const seenSnap = new Set();
  const seenDir = new Set();
  const walkSnap = (name, v) => {
    // The snapshot key is "<name>@<version(peers)>"; an npm alias is locked as
    // "<real-name>@<version>" and is its own key.
    const bare = v.split("(")[0];
    const at = bare.lastIndexOf("@");
    const key = at > 0 ? v : `${name}@${v}`;
    if (seenSnap.has(key)) return;
    seenSnap.add(key);
    out.add(at > 0 ? bare : `${name}@${bare}`);
    const s = lock?.snapshots?.[key] ?? {};
    for (const [n, cv] of Object.entries({ ...(s.dependencies ?? {}), ...(s.optionalDependencies ?? {}) })) walkSnap(n, String(cv));
  };
  const walkImporter = (d, names) => {
    if (seenDir.has(d)) return;
    seenDir.add(d);
    const imp = lock?.importers?.[d] ?? {};
    const deps = { ...(imp.dependencies ?? {}), ...(imp.optionalDependencies ?? {}) };
    for (const n of names ?? Object.keys(deps)) {
      const v = String(deps[n]?.version ?? "");
      if (!v) continue;
      if (v.startsWith("link:")) walkImporter(posixJoin(d, v.slice(5)), null);
      else walkSnap(n, v);
    }
  };
  walkImporter(dir, [...shippedNames]);
  return out;
}

function posixJoin(a, b) {
  const parts = `${a}/${b}`.split("/");
  const st = [];
  for (const p of parts) { if (p === "..") st.pop(); else if (p && p !== ".") st.push(p); }
  return st.join("/");
}

/** One OSV record → the severity bucket a human reads. MAL-* is always critical. */
export function osvSeverity(v) {
  if (String(v?.id ?? "").startsWith("MAL-")) return "critical";
  const s = String(v?.database_specific?.severity ?? "").toLowerCase();
  return SEVERITIES.includes(s) ? s : "unrated";
}

/** The versions an OSV record says fix it, for this npm package. Empty = no fix yet. */
export function osvFixed(v, name) {
  const fixed = new Set();
  for (const a of v?.affected ?? []) {
    if (a.package?.ecosystem !== "npm" || a.package?.name !== name) continue;
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) fixed.add(e.fixed);
  }
  return [...fixed];
}

/** Findings for one package → counts + the list. `vulnsByDep` maps "name@version" →
 *  OSV records; `kev` is a Set of CVE ids, or null when KEV could not be read. */
export function summarizeOsv(shipped, vulnsByDep, kev) {
  const counts = { ...zero(), unrated: 0 };
  const findings = [];
  const seen = new Set();
  for (const dep of [...shipped].sort()) for (const v of vulnsByDep.get(dep) ?? []) {
    if (seen.has(v.id)) continue; // one hole counted once, however many paths reach it
    seen.add(v.id);
    const severity = osvSeverity(v);
    counts[severity]++;
    const aliases = v.aliases ?? [];
    findings.push({
      id: v.id, dep, severity, summary: v.summary ?? "",
      fixed: osvFixed(v, dep.slice(0, dep.lastIndexOf("@"))),
      malicious: v.id.startsWith("MAL-"),
      kev: kev ? aliases.some((a) => kev.has(a)) : null,
    });
  }
  return { status: "ok", ...counts, findings };
}

/** Ask OSV for every dependency at once. Returns Map("name@version" → full records).
 *  Throws on any failure — the caller records «could not check», never zero. */
export async function queryOsv(deps, fetchImpl = fetch) {
  const list = [...deps];
  const ids = new Map(); // dep → [ids]
  for (let i = 0; i < list.length; i += 1000) {
    const chunk = list.slice(i, i + 1000);
    const queries = chunk.map((d) => { const at = d.lastIndexOf("@"); return { package: { ecosystem: "npm", name: d.slice(0, at) }, version: d.slice(at + 1) }; });
    const r = await fetchImpl("https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries }) });
    if (!r.ok) throw new Error(`OSV querybatch HTTP ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j.results) || j.results.length !== chunk.length) throw new Error("OSV querybatch: answer does not match the questions");
    j.results.forEach((res, k) => {
      if (res.next_page_token) throw new Error(`OSV querybatch: more than one page for ${chunk[k]}`);
      if (res.vulns?.length) ids.set(chunk[k], res.vulns.map((v) => v.id));
    });
  }
  const records = new Map();
  for (const id of new Set([...ids.values()].flat())) {
    const r = await fetchImpl(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`OSV vulns/${id} HTTP ${r.status}`);
    records.set(id, await r.json());
  }
  return new Map([...ids].map(([dep, list]) => [dep, list.map((id) => records.get(id))]));
}

/** CISA's Known Exploited Vulnerabilities → Set of CVE ids, or null if unreadable. */
export async function readKev(fetchImpl = fetch) {
  try {
    const r = await fetchImpl("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json");
    if (!r.ok) return null;
    return new Set((await r.json()).vulnerabilities.map((v) => v.cveID));
  } catch { return null; } // KEV only ranks; the OSV result stands without it, marked kev:null
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

  // A peer dependency is the APP's install, not ours: pnpm auto-installs it here
  // for tests, and `audit --prod` reports it as if the package shipped it. Measured
  // 23/10: all 5 critical + 14 high of @broberg/auth came through its optional
  // peer `next`. So only `dependencies` count as shipped; peer findings are kept
  // apart (row.peer) — the app's own audit is where they get fixed.
  const shipped = new Map(pkgs.map((p) => [p.dir, new Set(Object.keys(p.json.dependencies ?? {}))]));
  const peerOnly = new Map(pkgs.map((p) => [p.dir, new Set(Object.keys(p.json.peerDependencies ?? {}).filter((d) => !(d in (p.json.dependencies ?? {}))))]));
  let prod = null, peer = null, all = null, auditError = null;
  try {
    const prodAudit = runJson("pnpm", ["audit", "--prod", "--json"], root);
    prod = summarizeAudit(prodAudit, (dir, dep) => shipped.get(dir)?.has(dep) ?? true);
    peer = summarizeAudit(prodAudit, (dir, dep) => peerOnly.get(dir)?.has(dep) ?? false);
    all = summarizeAudit(runJson("pnpm", ["audit", "--json"], root));
  } catch (e) {
    auditError = e.message;
  }

  // F082.9 — OSV.dev over every locked dependency a package ships, in one batch.
  let lock = null, vulnsByDep = null, kev = null, osvError = null;
  const shippedDeps = new Map();
  try {
    const { parse } = await import("yaml");
    lock = parse(readFileSync(`${root}pnpm-lock.yaml`, "utf8"));
    for (const p of pkgs) shippedDeps.set(p.dir, lockedShipped(lock, p.dir, shipped.get(p.dir)));
    vulnsByDep = await queryOsv(new Set([...shippedDeps.values()].flatMap((s) => [...s])));
    kev = await readKev();
  } catch (e) {
    osvError = `OSV: ${e.message}`;
  }

  const packages = {};
  for (const p of pkgs) {
    const row = { version: p.json.version, status: "ok", prod: zero(), peer: zero(), dev: zero(), outdated: { total: 0, shipped: 0, deprecated: 0 } };
    if (auditError) { row.status = "error"; row.error = auditError; }
    else {
      row.prod = prod[p.dir] ?? zero();
      row.peer = peer[p.dir] ?? zero();
      const a = all[p.dir] ?? zero();
      // dev = everything the full audit found minus what ships and what the app supplies.
      row.dev = Object.fromEntries(SEVERITIES.map((s) => [s, Math.max(0, a[s] - row.prod[s] - row.peer[s])]));
    }
    try {
      row.outdated = summarizeOutdated(runJson("pnpm", ["outdated", "--format", "json"], `${root}${p.dir}`));
    } catch (e) {
      row.status = "error";
      row.error = [row.error, e.message].filter(Boolean).join(" · ");
    }
    row.osv = osvError ? { status: "error", error: osvError } : summarizeOsv(shippedDeps.get(p.dir), vulnsByDep, kev);
    row.verdict = verdict(row);
    packages[p.json.name] = row;
    console.error(`${p.json.name.padEnd(34)} ${row.verdict.padEnd(16)} prod c${row.prod.critical} h${row.prod.high} m${row.prod.moderate} · osv ${row.osv.status === "ok" ? `c${row.osv.critical} h${row.osv.high} (${shippedDeps.get(p.dir).size} deps)` : "error"} · outdated ${row.outdated.total} (${row.outdated.shipped} shipped)`);
  }

  const result = { checked_at: new Date().toISOString(), sources: { osv: osvError ? "error" : "ok", kev: kev ? "ok" : "unread" }, packages };
  const json = JSON.stringify(result, null, 1) + "\n";
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
  // A run where NOTHING could be checked is a failed run, not a clean fleet.
  if (Object.values(packages).every((r) => r.status === "error")) process.exit(1);
}

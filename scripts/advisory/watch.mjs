#!/usr/bin/env node
// F082.10 — the fleet's shared advisory watch, run inside the CALLING repo.
//
//   node watch.mjs --mode watch|gate [--ack .github/advisory-ack.json]
//                  [--label advisory-watch] [--color B60205] [--report advisory.json]
//
// gate  — the deploy gate: decide and exit 1 unless clean. Touches nothing.
// watch — the daily check: same decision, then one GitHub issue per hole and an
//         Upmetrics incident (key via OIDC), closed when the hole is gone.
// Both modes run the SAME decision (engine.mjs), so the gate and the daily check
// can never measure differently (bid #4318 a).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { detectPm, parseAudit, lockedFromLockfile, decide, planAlarm, issueTitle } from "./engine.mjs";
import { queryOsv, readKev, osvSeverity } from "../dependency-health.mjs";

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const mode = arg("mode", "watch");
const ackPath = arg("ack", ".github/advisory-ack.json");
const label = arg("label", "advisory-watch");
const color = arg("color", "B60205");
const reportPath = arg("report", "advisory.json");

/** stdout even when the command exits non-zero — the exit code is not the signal. */
function run(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64e6, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { return typeof e?.stdout === "string" ? e.stdout : ""; }
}

const pm = detectPm(readdirSync("."));
let audit = [], auditError = null, osv = [], osvError = null, ack = {}, kev = null;

if (!pm) auditError = "no package-lock.json, pnpm-lock.yaml or bun.lock — nothing could be checked";
else {
  try { audit = parseAudit(pm, run(pm, ["audit", "--json"])); }
  catch (e) { auditError = `${pm} audit: ${e.message}`; }
  try {
    const lockFile = { npm: "package-lock.json", pnpm: "pnpm-lock.yaml", bun: "bun.lock" }[pm];
    if (!existsSync(lockFile)) throw new Error(`${lockFile} not found (a binary bun.lockb cannot be read — run bun with a text lockfile)`);
    const locked = lockedFromLockfile(pm, readFileSync(lockFile, "utf8"));
    if (locked.size === 0) throw new Error(`no packages read from ${lockFile}`);
    const byDep = await queryOsv(locked);
    kev = await readKev();
    for (const [dep, vulns] of byDep) for (const v of vulns) {
      const pkg = dep.slice(0, dep.lastIndexOf("@"));
      osv.push({ pkg, id: v.id, severity: osvSeverity(v), title: v.summary ?? v.id, kev: kev ? (v.aliases ?? []).some((a) => kev.has(a)) : null });
    }
  } catch (e) { osvError = `OSV: ${e.message}`; }
}
if (existsSync(ackPath)) {
  try { ack = JSON.parse(readFileSync(ackPath, "utf8")); }
  catch (e) { ack = { [ackPath]: null }; console.error(`ack file is not JSON: ${e.message}`); }
}

const report = { ...decide({ auditError, audit, osvError, osv, ack }), pm, mode, kev: kev ? "read" : "unread", checked_at: new Date().toISOString() };
writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(`\n  ${pm ?? "?"} · status ${report.status} · blocking ${report.blocking.length} · acknowledged ${report.acknowledged.length} · OSV ${osvError ? "error" : "ok"} · KEV ${report.kev}`);
for (const e of report.errors) console.log(`::error::${e}`);
for (const f of report.blocking) console.log(`::error::${issueTitle(f)} (${f.sources.join("+")}${f.kev ? ", CISA KEV" : ""})`);
for (const f of report.acknowledged) console.log(`  acknowledged ${f.pkg} ${f.id}: ${ack[f.pkg].reason}`);

if (mode === "watch") await alarm(report);
process.exit(report.status === "clean" ? 0 : 1);

async function alarm(report) {
  // The fleet shares one GitHub quota. A 403 there must turn the run red, never
  // pass for «nothing to report» (bid #4318 e) — so gh failures are not caught.
  const gh = (...a) => {
    try { return execFileSync("gh", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) {
      const why = String(e?.stderr ?? e?.message ?? e);
      console.log(`::error::gh ${a[0]} ${a[1]} failed${/rate limit|403/i.test(why) ? " (GitHub rate limit)" : ""}: ${why.split("\n")[0]}`);
      process.exit(1);
    }
  };
  gh("label", "create", label, "--color", color, "--description", "F082.10 dagligt sårbarhedstjek", "--force");
  const openIssues = JSON.parse(gh("issue", "list", "--label", label, "--state", "open", "--limit", "500", "--json", "number,title"));
  const { open, close } = planAlarm(report, openIssues);
  const key = open.length || close.length ? await upmetricsKey() : null;
  for (const f of open) {
    gh("issue", "create", "--label", label, "--title", issueTitle(f), "--body",
      `Det daglige sårbarhedstjek (F082.10) fandt et ukvitteret ${f.severity}-hul.\n\n- pakke: \`${f.pkg}\`\n- hul: https://osv.dev/vulnerability/${f.id}\n- kilde: ${(f.sources ?? ["tjekket"]).join(", ")}${f.kev ? "\n- **udnyttes aktivt (CISA KEV)**" : ""}\n\nOpgradér pakken, eller kvittér i \`${ackPath}\` med begrundelse. Sagen lukkes af sig selv, når tjekket er grønt.`);
    console.log(`OPENED ${f.id} · Upmetrics: ${await upmetrics(key, "/api/incidents", { kind: "dependency_vuln", fingerprint: f.id, severity: f.severity === "critical" ? "critical" : "high", title: issueTitle(f) })}`);
  }
  for (const s of close) {
    gh("issue", "close", String(s.number), "--comment", "Det daglige tjek er grønt for dette hul — lukket automatisk.");
    console.log(`CLOSED #${s.number} · Upmetrics: ${await upmetrics(key, "/api/incidents/resolve", { kind: "dependency_vuln", fingerprint: /^\[([^\]]+)\]/.exec(s.title)?.[1] })}`);
  }
  console.log(`opened ${open.length} · closed ${close.length} · still open ${openIssues.length - close.length}`);
}

// Upmetrics, exactly as BID: the key is minted per run from GitHub's OIDC token —
// nothing stored. Missing endpoint or no id-token permission is logged, not hidden.
async function upmetricsKey() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, tok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const base = process.env.UPMETRICS_URL ?? "https://upmetrics.org";
  if (!url || !tok) return null;
  const oidc = await (await fetch(`${url}&audience=${base}`, { headers: { authorization: `bearer ${tok}` } })).json();
  if (!oidc.value) return null;
  const r = await fetch(`${base}/api/enroll`, { method: "POST", headers: { authorization: `Bearer ${oidc.value}`, "content-type": "application/json" }, body: JSON.stringify({ platform: "node" }) });
  if (!r.ok) return null;
  const k = (await r.json()).api_key ?? null;
  if (k) console.log(`::add-mask::${k}`);
  return k;
}
async function upmetrics(key, path, body) {
  if (!key) return "no key (OIDC)";
  const r = await fetch(`${process.env.UPMETRICS_URL ?? "https://upmetrics.org"}${path}`, { method: "POST", headers: { "x-upmetrics-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.ok ? "ok" : `HTTP ${r.status}`;
}

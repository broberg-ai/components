#!/usr/bin/env node
// F115.2 — an open high/critical CodeQL alert on the default branch blocks a release.
//
//   GH_TOKEN=… node scripts/check-codeql-alerts.mjs [owner/repo]
//
// CodeQL itself only reports into the Security tab; nothing there stops a publish.
// This reads the open alerts through the API and turns high/critical into a red
// exit. Fail-closed: an API error, an unauthorised token or a repo with code
// scanning switched off is red — «could not check» is never clean.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const BLOCKING = new Set(["critical", "high"]);

/** Has CodeQL finished analysing THIS commit? `analyses` = the API's list (newest first). */
export function analysisFor(analyses, sha) {
  return Array.isArray(analyses) && analyses.some((a) => a?.commit_sha === sha && !a?.error);
}

/** alerts: the API's list → { blocking, status } */
export function decideAlerts(alerts) {
  if (!Array.isArray(alerts)) return { status: "error", blocking: [], why: "the alerts list is not an array" };
  const open = alerts.filter((a) => a.state === "open");
  const blocking = open.filter((a) => BLOCKING.has(String(a.rule?.security_severity_level ?? "").toLowerCase()));
  return { status: blocking.length ? "blocking" : "clean", blocking, open: open.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.argv[2]?.startsWith("--") ? process.env.GITHUB_REPOSITORY : (process.argv[2] ?? process.env.GITHUB_REPOSITORY);
  if (!repo) { console.log("::error::no repository given"); process.exit(1); }
  // The alerts of main are only TRUE once CodeQL has analysed the commit being judged — reading them while that analysis
  // is still running judges the PREVIOUS commit (found 20/11 2026: a fix for an alert went red on itself, because the
  // alert it fixed was still open when the job looked). --sha waits for the analysis of that commit, up to --wait seconds,
  // and is RED if it never appears: «not analysed» is not «no alerts».
  const shaI = process.argv.indexOf("--sha");
  const sha = shaI > 0 ? process.argv[shaI + 1] : "";
  const waitI = process.argv.indexOf("--wait");
  const waitMs = (waitI > 0 ? Number(process.argv[waitI + 1]) : 0) * 1000;
  if (sha) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      let analyses = null;
      try { analyses = JSON.parse(execFileSync("gh", ["api", `repos/${repo}/code-scanning/analyses?per_page=30`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64e6 })); } catch { /* retried until the deadline */ }
      if (analysisFor(analyses, sha)) { console.log(`codeql: analysis of ${sha.slice(0, 8)} is in`); break; }
      if (Date.now() >= deadline) { console.log(`::error::CodeQL has no analysis of ${sha.slice(0, 8)} for ${repo} after ${waitMs / 1000}s — "not analysed" is not "no alerts"`); process.exit(1); }
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
  const fi = process.argv.indexOf("--alerts-file");   // offline: the tests feed a recorded API answer
  let alerts;
  try {
    const raw = fi > 0 ? readFileSync(process.argv[fi + 1], "utf8") : execFileSync("gh", ["api", "--paginate", "--slurp", `repos/${repo}/code-scanning/alerts?state=open&ref=refs/heads/main&per_page=100`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64e6 });
    alerts = fi > 0 ? JSON.parse(raw) : JSON.parse(raw).flat();
  } catch (e) {
    console.log(`::error::could not read code-scanning alerts for ${repo}: ${String(e.stderr ?? e.message).trim().split("\n")[0]}`);
    process.exit(1);
  }
  const r = decideAlerts(alerts);
  console.log(`codeql alerts (${repo}, main): ${r.open ?? 0} open · ${r.blocking.length} high/critical → ${r.status}`);
  for (const a of r.blocking) console.log(`::error::${a.rule?.security_severity_level} ${a.rule?.id} — ${a.most_recent_instance?.location?.path}:${a.most_recent_instance?.location?.start_line} — ${a.html_url}`);
  process.exit(r.status === "clean" ? 0 : 1);
}

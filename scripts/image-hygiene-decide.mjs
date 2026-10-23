#!/usr/bin/env node
// F105.1 — read a Trivy JSON report of a freshly built Fly image and decide.
//
//   node scripts/image-hygiene-decide.mjs <trivy.json>   → prints the decision JSON
//
// The rule (cardmem-F401, Christian 23/10 2026): only a CRITICAL vulnerability
// that HAS a fix blocks the deploy — rebuilding cannot do better than the fix
// that exists. A critical with no fix is deployed anyway (the new image is no
// worse than the running one) and reported red, so it stays visible.
import { readFileSync } from "node:fs";

/** Trivy JSON → counts. A vulnerability counted once per (id, package), however
 *  many layers or targets repeat it. `vulnerabilities` names the criticals WITH a
 *  fix (max 50) — the ones that block — so cardmem's card can say which. */
export function countVulns(trivy) {
  const seen = new Set();
  const c = { critical_fixable: 0, critical_unfixable: 0, high: 0, vulnerabilities: [] };
  for (const r of trivy?.Results ?? []) {
    for (const v of r.Vulnerabilities ?? []) {
      const key = `${v.VulnerabilityID}|${v.PkgName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (v.Severity === "CRITICAL") {
        if (v.FixedVersion) {
          c.critical_fixable++;
          if (c.vulnerabilities.length < 50) c.vulnerabilities.push({ id: v.VulnerabilityID, pkg: v.PkgName, fixed: v.FixedVersion });
        }
        else c.critical_unfixable++;
      } else if (v.Severity === "HIGH") c.high++;
    }
  }
  return c;
}

/** counts → { status, deploy, red }. status is cardmem's contract (ok|blocked). */
export function decide(counts) {
  if (counts.critical_fixable > 0) return { status: "blocked", deploy: false, red: true };
  return { status: "ok", deploy: true, red: counts.critical_unfixable > 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  let counts;
  try {
    counts = countVulns(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    // No report = we do not know what is in the image. Never deploy blind.
    console.log(JSON.stringify({ status: "failed", deploy: false, red: true, error: `trivy report unreadable: ${e instanceof Error ? e.message : e}` }));
    process.exit(0);
  }
  console.log(JSON.stringify({ ...decide(counts), ...counts }));
}

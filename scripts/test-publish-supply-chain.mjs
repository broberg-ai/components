#!/usr/bin/env node
// F115.4/F115.8 — every publish job audits the tarball, builds an SBOM before it
// publishes, and verifies provenance + signatures on the registry after. A 58th
// package added by copy-paste without these steps goes red here, not unnoticed.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const text = readFileSync(".github/workflows/publish.yml", "utf8");
const jobs = text.split(/\n(?=  publish-[a-z0-9-]+:\n)/).filter((b) => /^  publish-[a-z0-9-]+:\n/.test(b.trimStart().length ? b : ""));
assert.ok(jobs.length >= 50, `reach control: found only ${jobs.length} publish jobs`);
let bad = 0;
for (const j of jobs) {
  const name = j.match(/^\s*(publish-[a-z0-9-]+):/)[1];
  const at = (s) => j.indexOf(s);
  const dir = j.match(/working-directory: (packages\/[a-z0-9-]+)\n\s+run: npm publish/)?.[1];
  const problems = [];
  if (!dir) problems.push("no «npm publish» step with a packages/ working-directory");
  else {
    const pub = at("run: npm publish");
    if (!(at(`node scripts/check-tarball-contents.mjs ${dir}`) > -1 && at(`node scripts/check-tarball-contents.mjs ${dir}`) < pub)) problems.push("tarball audit missing or after publish");
    if (!(at(`node scripts/gen-sbom.mjs ${dir}`) > -1 && at(`node scripts/gen-sbom.mjs ${dir}`) < pub)) problems.push("SBOM missing or after publish");
    if (!(at("node scripts/verify-provenance.mjs") > pub)) problems.push("registry provenance check missing or before publish");
  }
  if (problems.length) { bad++; console.log(`::error::${name}: ${problems.join("; ")}`); }
}
console.log(`publish supply chain: ${jobs.length} jobs · ${bad} without the full chain`);
process.exit(bad ? 1 : 0);

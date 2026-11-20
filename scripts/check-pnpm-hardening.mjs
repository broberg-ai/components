#!/usr/bin/env node
// F115.5 — the pnpm supply-chain settings in pnpm-workspace.yaml cannot be
// removed or weakened without CI going red.
//   · onlyBuiltDependencies exists, and every entry carries a «# reason» on its line
//   · minimumReleaseAge >= 1440 minutes (24 h), and only @broberg/* is excluded
//   · blockExoticSubdeps is true
import { readFileSync } from "node:fs";

export const MIN_AGE = 1440;

export function problems(text) {
  const out = [];
  const num = (k) => { const m = text.match(new RegExp(`^${k}:\\s*(\\d+)\\s*(#.*)?$`, "m")); return m ? Number(m[1]) : null; };
  const only = text.match(/^onlyBuiltDependencies:\s*(\[\s*\])?\s*(#.*)?$/m);
  if (!only) out.push("onlyBuiltDependencies is missing (install scripts must be default-deny with an explicit list)");
  else if (!only[1]) {
    const block = text.slice(only.index + only[0].length).split("\n").slice(1);
    for (const l of block) {
      if (!/^\s+-\s/.test(l)) { if (l.trim() && !l.trim().startsWith("#")) break; else continue; }
      if (!/\s#\s*\S/.test(l)) out.push(`onlyBuiltDependencies entry has no reason: ${l.trim()}`);
    }
  }
  const age = num("minimumReleaseAge");
  if (age === null) out.push("minimumReleaseAge is missing");
  else if (age < MIN_AGE) out.push(`minimumReleaseAge ${age} is below ${MIN_AGE} minutes`);
  const ex = text.match(/^minimumReleaseAgeExclude:\s*\n((?:\s+-\s.*\n?)*)/m);
  for (const l of (ex?.[1] ?? "").split("\n").filter((x) => x.trim())) {
    const v = l.replace(/^\s*-\s*/, "").replace(/\s*#.*$/, "").replace(/["']/g, "");
    if (v !== "@broberg/*") out.push(`minimumReleaseAgeExclude may only name @broberg/*, found ${v}`);
  }
  if (!/^blockExoticSubdeps:\s*true\s*(#.*)?$/m.test(text)) out.push("blockExoticSubdeps must be true");
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] ?? "pnpm-workspace.yaml";
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) { console.log(`::error::cannot read ${file}: ${e.message}`); process.exit(1); }
  const p = problems(text);
  for (const x of p) console.log(`::error file=${file}::${x}`);
  console.log(`pnpm hardening: ${p.length ? p.length + " problem(s)" : "ok"}`);
  process.exit(p.length ? 1 : 0);
}

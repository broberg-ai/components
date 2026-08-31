#!/usr/bin/env node
// F061.4 — mutation pass for the pre-commit secret gate.
//
// Each mutation is applied to a COPY of the hook and run via GATE_HOOK. The real
// .githooks/pre-commit is never written to, so an interrupted run cannot leave a
// mutant behind — the failure mode where a harness kills itself mid-mutation and
// the "restore" never happens.
//
// Every mutation asserts its ANCHOR applied. A substitution that silently matched
// nothing reads exactly like a surviving mutant, and that is the lie this harness
// exists to not tell.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const HOOK = join(REPO, ".githooks", "pre-commit");
const TEST = join(REPO, "scripts", "test-precommit-secret-gate.mjs");
const original = readFileSync(HOOK, "utf8");

const MUTATIONS = [
  {
    // NOTE: dropping -U0 alone does NOT reintroduce the defect — the grep still
    // strips '-' lines, so the suite stayed green and this harness reported it
    // UNCAUGHT. The load-bearing part is the FILTER, not the context width. That
    // correction came from the harness, not from reading the diff.
    name: "extraction reverted to the FULL diff, filter removed (the original defect)",
    find: `  git diff --cached -U0 -- "$@" \\
    | { grep '^+' || true; } \\
    | { grep -v '^+++' || true; } \\
    | sed 's/^+//'`,
    replace: `  git diff --cached -- "$@"`,
    expect: "removing a credential is ALLOWED",
  },
  {
    name: "extraction weakened to scan NOTHING",
    find: `    | { grep '^+' || true; } \\`,
    replace: `    | { grep '^ZZZ_NEVER_MATCHES' || true; } \\`,
    expect: "adding a credential is REFUSED",
  },
];

let uncaught = 0;
const redSets = [];

for (const m of MUTATIONS) {
  if (!original.includes(m.find)) {
    console.log(`ANCHOR MISSING — ${m.name}\n  the substitution matched nothing, so this mutation was never applied`);
    uncaught++;
    continue;
  }
  const mutated = original.replace(m.find, m.replace);
  if (mutated === original) { console.log(`ANCHOR NO-OP — ${m.name}`); uncaught++; continue; }

  const dir = mkdtempSync(join(tmpdir(), "mut-"));
  const path = join(dir, "pre-commit");
  writeFileSync(path, mutated, { mode: 0o755 });

  let out = "";
  let died = false;
  try {
    execFileSync("node", [TEST], { env: { ...process.env, GATE_HOOK: path }, stdio: "pipe" });
  } catch (e) {
    out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
    died = true;
  }
  if (!died) {
    console.log(`UNCAUGHT — ${m.name}\n  the suite stayed GREEN with this mutation applied`);
    uncaught++;
    continue;
  }
  const red = out.split("\n").filter((l) => l.startsWith("  FAIL")).map((l) => l.trim());
  const hit = red.some((l) => l.includes(m.expect));
  redSets.push(red.join("|"));
  console.log(`${hit ? "killed" : "WRONG RED"} — ${m.name}`);
  red.forEach((l) => console.log(`     ${l}`));
  if (!hit) uncaught++;
}

const identical = redSets.length !== new Set(redSets).size;
if (identical) console.log("\nWARNING: two mutations produced IDENTICAL red sets — one test may be carrying both");
console.log(`\n${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets`);
process.exit(uncaught === 0 && !identical ? 0 : 1);

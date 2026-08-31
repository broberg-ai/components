#!/usr/bin/env node
// F068.3 — mutation pass for the widened file universe.
//
// Each mutation is applied to a COPY of src/index.ts and the suite is run against
// it. The real source is never written to, so an interrupted run cannot leave a
// mutant on disk — the failure mode where a harness kills itself mid-mutation and
// the "restore" never happens.
//
// Every mutation asserts its ANCHOR applied. A substitution that silently matched
// nothing reads exactly like a surviving mutant, and that is the lie this exists
// to not tell.
//
// The two mutations must produce DIFFERENT red sets. If they matched, one test
// would be carrying both claims and neither would be pinned on its own.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const PKG = join(REPO, "packages", "greppable");
const SRC = join(PKG, "src", "index.ts");
const original = readFileSync(SRC, "utf8");

const MUTATIONS = [
  {
    // The defect this card fixes, restored exactly.
    name: "back to tracked-only (the pre-F068.3 blindness)",
    find: `  const untrackedFiles = listFiles(["--others", "--exclude-standard"]);`,
    replace: `  const untrackedFiles: string[] = [];`,
    expect: ["finds an UNTRACKED NUL file", "finds an UNTRACKED latin-1 file"],
  },
  {
    // The regression the fix could trivially introduce, which would be WORSE than
    // the bug: node_modules/ and dist/ buried in every run.
    name: "--exclude-standard dropped, so .gitignore stops being honoured",
    find: `  const untrackedFiles = listFiles(["--others", "--exclude-standard"]);`,
    replace: `  const untrackedFiles = listFiles(["--others"]);`,
    expect: ["still does NOT scan ignored paths"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "grepmut-"));
const safe = join(backup, "index.ts");
copyFileSync(SRC, safe);

let uncaught = 0;
const redSets = [];

try {
  for (const m of MUTATIONS) {
    if (!original.includes(m.find)) {
      console.log(`ANCHOR MISSING — ${m.name}\n  the substitution matched nothing, so this mutation was never applied`);
      uncaught++;
      continue;
    }
    const mutated = original.replace(m.find, m.replace);
    if (mutated === original) { console.log(`ANCHOR NO-OP — ${m.name}`); uncaught++; continue; }

    writeFileSync(SRC, mutated);
    let out = "";
    let died = false;
    try {
      execFileSync("pnpm", ["vitest", "run"], { cwd: PKG, stdio: "pipe" });
    } catch (e) {
      out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
      died = true;
    }
    if (!died) {
      console.log(`UNCAUGHT — ${m.name}\n  the suite stayed GREEN with this mutation applied`);
      uncaught++;
      continue;
    }
    // STRIP ANSI FIRST. Under CI vitest keeps colour on (turbo sets FORCE_COLOR),
    // so a failing line arrives as "\u001b[31m×\u001b[39m name" and an anchored
    // /^\s*×/ matches nothing. Measured: this harness reported "2 mutations, 2
    // uncaught" on CI while both mutations had in fact been killed — it could not
    // READ the red it had caused. It failed in the safe direction, which is the
    // only reason it was merely noisy rather than a false all-clear.
    const clean = out.replace(/\u001B\[[0-9;]*m/g, "");
    const red = [...new Set(
      clean.split("\n").filter((l) => /^\s*(×|✕|FAIL)/.test(l)).map((l) => l.trim()),
    )];

    // "the suite died but I cannot see WHICH test" is a third state, and it must
    // not be reported as "the mutation survived". They are opposite facts.
    if (red.length === 0) {
      console.log(`UNREADABLE — ${m.name}`);
      console.log(`  the suite FAILED (so the mutation was caught) but no failing test line`);
      console.log(`  could be parsed from its output, so this harness cannot say WHICH test`);
      console.log(`  caught it. That is a defect in the harness, not evidence about the code.`);
      console.log(`  last output lines:`);
      clean.split("\n").filter(Boolean).slice(-6).forEach((l) => console.log(`     ${l.trim()}`));
      uncaught++;
      redSets.push(`unreadable:${m.name}`);
      continue;
    }

    const hit = m.expect.every((e) => red.some((l) => l.includes(e)));
    redSets.push(red.join("|"));
    console.log(`${hit ? "killed" : "WRONG RED"} — ${m.name}`);
    red.slice(0, 6).forEach((l) => console.log(`     ${l}`));
    if (!hit) {
      console.log(`     expected all of: ${m.expect.join(" · ")}`);
      uncaught++;
    }
  }
} finally {
  copyFileSync(safe, SRC);
  rmSync(backup, { recursive: true, force: true });
}

const identical = redSets.length !== new Set(redSets).size;
if (identical) console.log("\nWARNING: two mutations produced IDENTICAL red sets — one test may be carrying both");
console.log(`\n${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets`);
process.exit(uncaught === 0 && !identical ? 0 : 1);

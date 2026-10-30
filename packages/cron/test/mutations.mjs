#!/usr/bin/env node
// F041.4 - mutation pass for @broberg/cron (harness carried over from @broberg/backup).
//
// Two properties: no mutation may go UNCAUGHT, and no two may produce the SAME
// red set - a mutation that reddens everything proves the suite runs, not that
// it discriminates.
//
// Carried over from @broberg/secret-scan's harness, including the three things
// a naive one gets wrong:
//   - it REFUSES to run on an uncommitted source file. `finally` does not run
//     on a kill, and a killed run leaves the source mutated, which reads exactly
//     like working source.
//   - it asserts every mutation's ANCHOR applied. A substitution that silently
//     matched nothing reads exactly like a surviving mutant.
//   - it STRIPS ANSI before parsing the failing lines. Under CI vitest keeps
//     colour on, so an anchored /^\s*x/ matches nothing and a caught mutation
//     is reported as uncaught - a harness that cannot read the red it caused.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
// F081.1 — announce the mutated tree, and PROVE the restore took.
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = {
  index: join(PKG, "src", "index.ts"),
};

// A mutant left on disk by a killed run is indistinguishable from real source.
for (const [name, file] of Object.entries(FILES)) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", file], { cwd: PKG })
    .toString()
    .trim();
  if (dirty) {
    console.error(
      `refusing to mutate an uncommitted file (src/${name}.ts).\n` +
        `  Commit first: a killed run skips the restore, and mutated source then\n` +
        `  reads exactly like working source.`,
    );
    process.exit(1);
  }
}

const MUTATIONS = [
  // F041.4 — a bad token is a 307 → /login. Follow it and a login page comes
  // back typed as Job[] (measured on the live service, 15/9).
  {
    name: "the client follows redirects again (redirect: manual removed)",
    file: "index",
    from: '      redirect: "manual",\n',
    to: "",
    expect: ["307 → /login throws a CronError with status 307 and the Location"],
  },
  // A non-JSON 200 handed back cast to T is how the login page became a Job[].
  {
    name: "a non-JSON 200 is returned cast to T again",
    file: "index",
    from: '    if (typeof data === "string") {',
    to: "    if (false) {",
    expect: ["throws naming the content-type and the first ~80 chars"],
  },
  // Every redirect claimed as an auth failure swaps one wrong diagnosis for another.
  {
    name: "every 3xx is reported as a rejected token",
    file: "index",
    from: "      const toLogin = location !== undefined &&",
    to: "      const toLogin = true || location !== undefined &&",
    expect: ["a LEGITIMATE redirect (308 to a moved endpoint)"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "backupmut-"));
const originals = {};
for (const [name, file] of Object.entries(FILES)) {
  originals[name] = readFileSync(file, "utf8");
  copyFileSync(file, join(backup, `${name}.ts`));
}

// Built from a char code so no literal escape byte lives in this file.
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

let uncaught = 0;
const redSets = [];

// BEFORE the first mutation. Written after it, the marker would leave open the
// exact window it exists to close. The file named is the first of the several
// this harness rotates through; it is updated per mutation below.
writeMarker({ harness: "@broberg/cron test/mutations.mjs", file: Object.values(FILES)[0] });
try {
  for (const m of MUTATIONS) {
    const file = FILES[m.file];
    const original = originals[m.file];
    if (!original.includes(m.from)) {
      console.log(`ANCHOR MISSING - ${m.name}`);
      console.log("  the substitution matched nothing, so this mutation was never applied");
      uncaught++;
      continue;
    }
    const mutated = original.replace(m.from, m.to);
    if (mutated === original) {
      console.log(`ANCHOR NO-OP - ${m.name}`);
      uncaught++;
      continue;
    }

    // This harness rotates across several files, so the marker has to name the
    // one that is broken RIGHT NOW — a reader who opens it wants that file, not
    // the first one the run happened to touch.
    writeMarker({ harness: "@broberg/cron test/mutations.mjs", file });
    writeFileSync(file, mutated);
    let out = "";
    let died = false;
    try {
      execFileSync("pnpm", ["exec", "vitest", "run"], { cwd: PKG, stdio: "pipe" });
    } catch (e) {
      out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
      died = true;
    } finally {
      writeFileSync(file, original);
      // The guard. A restore that FAILED is otherwise indistinguishable from one
      // that was not needed — which is how buddy's harness lost a file on
      // 2026-08-14 with a green run to show for it. Does not return on mismatch.
      assertRestored({ harness: "@broberg/cron test/mutations.mjs", file, expected: original });
    }

    if (!died) {
      console.log(`UNCAUGHT - ${m.name}`);
      console.log("  the suite stayed GREEN with this mutation applied");
      uncaught++;
      continue;
    }

    const clean = out.replace(ANSI, "");
    const red = [
      ...new Set(
        clean
          .split("\n")
          .filter((l) => /^\s*(\u00d7|\u2715|FAIL)/.test(l))
          // STRIP THE DURATION. vitest appends "10ms" / "1ms" / "2s" to each
          // failing line, and the identical-red-set check below compares these
          // strings. With the timing left in, two mutations that redden exactly
          // the SAME tests still compare unequal whenever one run was a
          // millisecond slower — so the discrimination check passed by accident.
          // Measured 2026-09-10: this harness reported "0 identical red sets"
          // locally and "1" in CI, same 24 mutations, same red counts. The CI
          // answer was the true one. A check whose verdict depends on how fast
          // the machine is, is not a check.
          .map((l) => l.trim().replace(/\s+\d+(?:\.\d+)?m?s$/, "")),
      ),
    ];

    // "the suite died but I cannot see WHICH test" is a third state, and it must
    // not be reported as "the mutation survived". They are opposite facts.
    if (red.length === 0) {
      console.log(`UNREADABLE - ${m.name}`);
      console.log("  the suite FAILED (so the mutation WAS caught) but no failing test");
      console.log("  line could be parsed, so this harness cannot say which test caught");
      console.log("  it. That is a defect in the harness, not evidence about the code.");
      clean.split("\n").filter(Boolean).slice(-6).forEach((l) => console.log(`     ${l.trim()}`));
      uncaught++;
      redSets.push(`unreadable:${m.name}`);
      continue;
    }

    const hit = m.expect.every((e) => red.some((l) => l.includes(e)));
    redSets.push(red.join("|"));
    console.log(`  ${hit ? "caught   " : "WRONG RED"} ${m.name}  -> ${red.length} red`);
    red.slice(0, 3).forEach((l) => console.log(`               . ${l}`));
    if (!hit) {
      console.log(`     expected all of: ${m.expect.join(" . ")}`);
      uncaught++;
    }
  }
} finally {
  for (const [name, file] of Object.entries(FILES)) {
    copyFileSync(join(backup, `${name}.ts`), file);
    assertRestored({ harness: "@broberg/cron test/mutations.mjs", file, expected: originals[name] });
  }
  rmSync(backup, { recursive: true, force: true });
  clearMarker();
}

// NAME THE PAIR. "two mutations produced identical red sets" sends the reader to
// re-run 24 mutations by hand to find out which two; the harness already knows.
const collisions = [];
{
  const seen = new Map();
  redSets.forEach((sig, i) => {
    if (seen.has(sig)) collisions.push([MUTATIONS[seen.get(sig)].name, MUTATIONS[i].name, sig]);
    else seen.set(sig, i);
  });
}
const identical = collisions.length > 0;
if (identical) {
  console.log("\nIDENTICAL RED SETS - one test is carrying both mutations, so only one of them is proven:");
  for (const [a, b, sig] of collisions) {
    console.log(`  . ${a}`);
    console.log(`  . ${b}`);
    sig.split("|").forEach((l) => console.log(`      both reddened: ${l}`));
  }
}
console.log(
  `\n${identical || uncaught ? "FAIL" : "OK"} - ${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets.`,
)
process.exit(uncaught === 0 && !identical ? 0 : 1);

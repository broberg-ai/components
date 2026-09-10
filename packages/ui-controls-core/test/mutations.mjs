#!/usr/bin/env node
// F016.8 — mutation pass for the month guard and the trailing option.
//
// Both defects shipped in 0.1.0 and survived three releases, because the package
// had NO consumers until cms measured it. So every mutation here restores a real
// defect, and each must redden a DIFFERENT named test — a mutation that reddens
// everything proves the suite runs, not that it discriminates.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(PKG, "src", "calendar.ts");

// A mutant left on disk by a killed run is indistinguishable from real source.
const dirty = execFileSync("git", ["status", "--porcelain", "--", FILE], { cwd: PKG }).toString().trim();
if (dirty) {
  console.error(
    "refusing to mutate an uncommitted file (src/calendar.ts).\n" +
      "  Commit first: a killed run skips the restore, and mutated source then\n" +
      "  reads exactly like working source.",
  );
  process.exit(1);
}

const MUTATIONS = [
  {
    // THE DEFECT, RESTORED. A month outside 1-12 went back to returning a full
    // 42-cell grid with inMonth: false on every cell — a silently empty month
    // that renders as a perfectly normal calendar.
    name: "the 1-12 guard is dropped (an invalid month renders as an empty calendar)",
    from: "  if (!Number.isInteger(month) || month < 1 || month > 12) {",
    to: "  if (false) {",
    expect: ["rejects 0 — the 0-indexed caller asking for January"],
  },
  {
    // Only the LOW end guarded. cms's report covered 0; the 13 end was ours,
    // and a guard that closes the reported half is the easy mistake here.
    name: "only the low bound is guarded (13 goes back to a silent empty grid)",
    from: "month < 1 || month > 12",
    to: "month < 1",
    expect: ["rejects 13 — the caller who added 1 to fix December"],
  },
  {
    // The remedy stops naming the convention, so the caller learns nothing
    // about WHY their 0 was refused.
    name: "the error stops naming the convention",
    from: "`buildMonthGrid: month must be 1-12 (1 = January), got ${month}. `",
    to: "`buildMonthGrid: bad month. `",
    expect: ["the error names the convention"],
  },
  {
    // THE REGRESSION THIS OPTION COULD PLAUSIBLY SHIP: fill-week becomes the
    // default, and every consumer's calendar silently changes height.
    name: "fill-week becomes the default (66 of 84 months change shape for every consumer)",
    from: "(opts.trailing ?? 'six-rows') === 'fill-week'",
    to: "(opts.trailing ?? 'fill-week') === 'fill-week'",
    expect: ["DEFAULT IS UNCHANGED"],
  },
  {
    // The option stops working at all — six rows whatever you ask for.
    name: "the trailing branch is dead (fill-week silently does nothing)",
    from: "? Math.ceil((lead + daysInMonth) / 7) * 7 : 42;",
    to: "? 42 : 42;",
    expect: ["fill-week stops at the last full week"],
  },
  {
    // Rounding DOWN instead of up: the last days of the month fall off the end
    // of the grid, which is the one way this option can lose real data.
    name: "the week rounding truncates the month (days fall off the grid)",
    from: "Math.ceil((lead + daysInMonth) / 7) * 7",
    to: "Math.floor((lead + daysInMonth) / 7) * 7",
    expect: ["never cuts a day that belongs to the month"],
  },
  {
    // The year guard dropped: NaN/Infinity go back to a 42-cell grid of
    // "NaN-NaN-NaN", and a two-digit year to a calendar for another century.
    name: "the year guard is dropped (NaN dates and a 1901 calendar come back)",
    from: "  if (!Number.isInteger(year) || year < 100 || year > 275760) {",
    to: "  if (false) {",
    expect: ["NaN and Infinity throw instead of returning a grid of NaN dates"],
  },
  {
    // Only the non-finite half guarded — the easy fix, and it leaves the
    // WORST case open: 1.5 renders an ordinary calendar for April 1901.
    name: "only non-finite years are guarded (the two-digit-year century shift survives)",
    from: "year < 100 || year > 275760",
    to: "year < -8.64e15",
    expect: ["a two-digit or fractional year throws rather than becoming another century"],
  },
  {
    // The over-strict direction: a guard that refuses everything passes every
    // test above and breaks every caller.
    name: "the year guard refuses ordinary years too (the over-strict direction)",
    from: "!Number.isInteger(year) || year < 100 || year > 275760",
    to: "true",
    expect: ["NEGATIVE CONTROL: ordinary years are not refused"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "uicmut-"));
const original = readFileSync(FILE, "utf8");
copyFileSync(FILE, join(backup, "calendar.ts"));

const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
let uncaught = 0;
const redSets = [];

writeMarker({ harness: "@broberg/ui-controls-core test/mutations.mjs", file: FILE });
try {
  for (const m of MUTATIONS) {
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

    writeFileSync(FILE, mutated);
    let out = "";
    let died = false;
    try {
      execFileSync("pnpm", ["exec", "vitest", "run"], { cwd: PKG, stdio: "pipe" });
    } catch (e) {
      out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
      died = true;
    } finally {
      writeFileSync(FILE, original);
      assertRestored({ harness: "@broberg/ui-controls-core test/mutations.mjs", file: FILE, expected: original });
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
          .filter((l) => /^\s*(×|✕|FAIL)/.test(l))
          // STRIP THE DURATION (F080.4). vitest appends "10ms" to each failing
          // line, and the identical-red-set check below compares these strings —
          // so two mutations reddening exactly the SAME tests compared unequal
          // whenever one run was a millisecond slower. Measured in @broberg/mail:
          // "0 identical" locally, "1" in CI, same mutations, same counts. The CI
          // answer was the true one, and the collision was real.
          .map((l) => l.trim().replace(/\s+\d+(?:\.\d+)?m?s$/, "")),
      ),
    ];

    // "the suite died but I cannot see WHICH test" is a third state, and it must
    // not be reported as "the mutation survived". They are opposite facts.
    if (red.length === 0) {
      console.log(`UNREADABLE - ${m.name}`);
      console.log("  the suite FAILED (so the mutation WAS caught) but no failing test line");
      console.log("  could be parsed. That is a defect in this harness, not evidence about the code.");
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
  copyFileSync(join(backup, "calendar.ts"), FILE);
  assertRestored({ harness: "@broberg/ui-controls-core test/mutations.mjs", file: FILE, expected: original });
  rmSync(backup, { recursive: true, force: true });
  clearMarker();
}

// AN IDENTICAL RED SET IS A FAILURE, NOT A WARNING (F080.4). It used to print
// and leave the exit code alone, so the one thing it measures — that each
// mutation is proven by something of its OWN — could not block anything. A real
// collision was found in @broberg/mail the day this changed: two mutations, one
// proof, and whichever was actually guarded, the other was riding on it.
// NAME the pair rather than sending the reader back through every mutation.
const collisions = [];
{
  const seen = new Map();
  redSets.forEach((sig, i) => {
    if (seen.has(sig)) collisions.push([MUTATIONS[seen.get(sig)].name, MUTATIONS[i].name, sig]);
    else seen.set(sig, i);
  });
}
if (collisions.length) {
  console.log("\nIDENTICAL RED SETS - one test is carrying both mutations, so only one of them is proven:");
  for (const [a, b, sig] of collisions) {
    console.log(`  . ${a}`);
    console.log(`  . ${b}`);
    sig.split("|").forEach((l) => console.log(`      both reddened: ${l}`));
  }
}
console.log(
  `\n${collisions.length || uncaught ? "FAIL" : "OK"} - ${MUTATIONS.length} mutations, ${uncaught} uncaught, ${collisions.length} identical red set(s)`,
);
process.exit(uncaught === 0 && collisions.length === 0 ? 0 : 1);

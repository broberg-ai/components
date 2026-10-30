#!/usr/bin/env node
// F093.1 - mutation pass for @broberg/backup (harness carried over from @broberg/mail).
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
  // BID 30/10: a refused delete (R2 object lock) failed a backup that was already written.
  {
    name: "a refused retention delete fails the whole backup again",
    file: "index",
    from: "          pruneSkipped.push({ key, reason: e instanceof Error ? e.message : String(e) });\n",
    to: "          throw e;\n",
  },
  {
    name: "prune:false is ignored (old copies on a locked bucket are deleted anyway)",
    file: "index",
    from: "  if (readBackMatches && input.prune !== false) {",
    to: "  if (readBackMatches) {",
  },
  {
    // The proof step skipped: an upload that 200'd is called a backup without the bytes ever being read back.
    name: "read-back is assumed to match",
    file: "index",
    from: "  const readBackMatches = back !== null && sha256(back.bytes) === ciphertextSha256;",
    to: "  const readBackMatches = true;",
    expect: ["read back wrong → readBackMatches false"],
  },
  {
    // Old copies deleted before the new one is proven: a bad night eats the last good backups.
    name: "retention runs even when the new copy is not proven",
    file: "index",
    from: "  if (readBackMatches) {\n    for (let d = KEEP_DAYS + 1;",
    to: "  if (true) {\n    for (let d = KEEP_DAYS + 1;",
    expect: ["an unproven new copy deletes NOTHING old — a bad night must not eat the last good backups"],
  },
  {
    // The window off by one: day 30 is deleted, so 'keep 30 days' keeps 29.
    name: "retention deletes day 30",
    file: "index",
    from: "    for (let d = KEEP_DAYS + 1; d <= KEEP_DAYS + 10; d++) {",
    to: "    for (let d = KEEP_DAYS; d <= KEEP_DAYS + 10; d++) {",
    expect: ["retention: days 31-40 back are deleted, day 30 is kept"],
  },
  {
    // Retention ignores the app's prefix: two apps in one bucket and one deletes in the wrong place.
    name: "retention deletes under the default prefix, not the app's",
    file: "index",
    from: "      await input.store.delete(objectKey(old, prefix));",
    to: "      await input.store.delete(objectKey(old));",
    expect: ["PREFIX BOUNDARY: an app's retention never touches another app's prefix in the same bucket"],
  },
  {
    // 'Already done today' trusts any file with the right name: a half copy is reported as a backup.
    name: "today's copy is trusted without checking its sha",
    file: "index",
    from: "    if (m.object === object && m.ciphertextSha256 === sha) {",
    to: "    if (m.object === object) {",
    expect: ["NEGATIVE: today's copy does not match its manifest → it writes, so the lock can refuse loudly"],
  },
  {
    // Freshness looks at the default prefix: another app's fresh copy turns this app's probe green.
    name: "freshness ignores the prefix it is given",
    file: "index",
    from: "    const [obj, man] = await Promise.all([store.get(objectKey(dd, prefix)), store.get(manifestKey(dd, prefix))]);",
    to: "    const [obj, man] = await Promise.all([store.get(objectKey(dd)), store.get(manifestKey(dd))]);",
    expect: ["freshness reads the prefix it is given — another app's fresh copy does not make this one green"],
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
writeMarker({ harness: "@broberg/backup test/mutations.mjs", file: Object.values(FILES)[0] });
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
    writeMarker({ harness: "@broberg/backup test/mutations.mjs", file });
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
      assertRestored({ harness: "@broberg/backup test/mutations.mjs", file, expected: original });
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
    assertRestored({ harness: "@broberg/backup test/mutations.mjs", file, expected: originals[name] });
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

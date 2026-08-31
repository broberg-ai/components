#!/usr/bin/env node
// F081.1 — the mutation pass for the gate itself.
//
// The gate exists because a failed restore looked exactly like no restore being
// needed. A gate that cannot itself be seen failing would be the same mistake at
// one remove, so each of the six decisions below is removed in turn and must
// turn a DISTINCT check in scripts/test-mutation-marker.mjs red.
//
// It deliberately does NOT import scripts/mutation-marker.mjs — that is the file
// under mutation, and a harness that leaned on its target would be reporting on
// itself. Absolute paths, refuse-on-dirty and a read-back are re-stated here.
//
//   node scripts/test-mutation-marker-mutations.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = join(ROOT, "scripts/mutation-marker.mjs");
const HOOK = join(ROOT, ".githooks/pre-commit");
const TEST = join(ROOT, "scripts/test-mutation-marker.mjs");

const MUTATIONS = [
  {
    name: "the marker is never written",
    file: MARKER,
    from: "  writeFileSync(entryPath(), body);",
    to: "  void body;",
  },
  {
    name: "the marker is never removed (it outlives the run)",
    file: MARKER,
    from: "  rmSync(entryPath(), { force: true });",
    to: "  /* leaked on purpose */",
  },
  {
    // THE RACE, restored. `turbo run test` runs packages in parallel, so this is
    // the ordinary path: a harness that clears the whole directory un-announces
    // every OTHER harness still mutating, and the window reopens in silence.
    // This is how it was built the first time.
    name: "clearMarker removes the whole directory, not just its own entry",
    file: MARKER,
    from: "  rmSync(entryPath(), { force: true });",
    to: "  rmSync(MARKER_PATH, { recursive: true, force: true });",
  },
  {
    name: "the marker stops naming the pid",
    file: MARKER,
    from: "    `  pid      ${process.pid}\\n` +",
    to: "    `  pid      (withheld)\\n` +",
  },
  {
    name: "the read-back always says the restore worked",
    file: MARKER,
    from: "  if (actual === expected) return;",
    to: "  if (true) return;",
  },
  {
    name: "a failed restore no longer raises the marker (the block drops)",
    file: MARKER,
    from: "  writeMarker({\n    harness,\n    file,\n    note:",
    to: "  if (false) writeMarker({\n    harness,\n    file,\n    note:",
  },
  {
    // -f instead of -e: the marker is a DIRECTORY, so a hook testing for a
    // regular file gives a false all-clear on every real run. This is the exact
    // wrong test, kept as a mutation because it is the one a reader would write.
    name: "the pre-commit hook tests for a FILE (-f), so the directory never matches",
    file: HOOK,
    from: 'if [ -e "$ROOT/.mutation-running" ]; then',
    to: 'if [ -f "$ROOT/.mutation-running" ]; then',
  },
];

// DELIBERATELY ABSENT, recorded rather than left as a gap: "the hook stops
// checking for the marker at all" (`if false; then`). It was written, it was
// killed, and its red set was IDENTICAL to the `-f` mutation above — both
// disable layer 0 entirely, so one test cannot tell them apart and neither is
// pinned on its own. The `-f` version is kept because it is the mistake a reader
// would actually make; a duplicate that proves nothing extra is noise dressed as
// coverage.

// The mutated gate can LEAK the marker (that is one of the mutations), and the
// test refuses to start when one already exists. Clear it between runs, or every
// mutation after the leaking one measures the leak instead of itself.
const STRAY_MARKER = join(ROOT, ".mutation-running");

function redSet() {
  rmSync(STRAY_MARKER, { recursive: true, force: true });
  let out = "";
  let died = false;
  try {
    out = execFileSync("node", [TEST], {
      cwd: ROOT, encoding: "utf8", stdio: "pipe",
      env: { ...process.env, F081_FAST: "1" },
    });
  } catch (e) {
    out = (e.stdout ?? "") + (e.stderr ?? "");
    died = true;
  }
  const red = out
    .split("\n")
    .filter((l) => l.trimStart().startsWith("✗"))
    .map((l) => l.trim())
    .sort();
  return { red, died, out };
}

// A kill skips the restore, and mutated source reads exactly like working
// source — the whole subject of this card.
const dirty = execFileSync(
  "git",
  ["status", "--porcelain", "--", "scripts/mutation-marker.mjs", ".githooks/pre-commit"],
  { cwd: ROOT, encoding: "utf8" },
).trim();
if (dirty) {
  console.error(`::error::refusing to mutate uncommitted files — commit first.\n  ${dirty}`);
  process.exit(1);
}

console.log("baseline (unmutated) …");
const base = redSet();
if (base.died || base.red.length) {
  console.error(`::error::the gate's own tests fail before any mutation:\n${base.out}`);
  process.exit(1);
}
console.log("  0 failures — so every red below is the mutation\n");

const seen = new Map();
let problems = 0;

for (const m of MUTATIONS) {
  const original = readFileSync(m.file, "utf8");
  if (!original.includes(m.from)) {
    // A substitution that matched nothing reads exactly like a surviving
    // mutant. Never merge the two.
    console.log(`ANCHOR MISSING — ${m.name}\n            the substitution matched nothing, so it never applied`);
    problems++;
    continue;
  }
  writeFileSync(m.file, original.replace(m.from, m.to));
  let r;
  try {
    r = redSet();
  } finally {
    writeFileSync(m.file, original);
    const back = existsSync(m.file) ? readFileSync(m.file, "utf8") : null;
    if (back !== original) {
      console.log("");
      console.log(`::error::RESTORE FAILED — ${relative(ROOT, m.file)} is still mutated on disk.`);
      console.log(`  git checkout -- ${relative(ROOT, m.file)}`);
      process.exit(1);
    }
  }

  // THREE OUTCOMES, NEVER TWO. "the gate died before it could report" and "the
  // gate ran and found nothing wrong" are opposite facts, and merging them is
  // the exact shape this whole card is about. Measured while writing this: one
  // mutation leaked the marker, the next run bailed at startup with no ✗ lines
  // at all, and FOUR mutations were reported as surviving when they had never
  // been tested.
  if (r.died && !r.red.length) {
    console.log(`  UNREADABLE ${m.name}`);
    console.log(`            the gate exited non-zero but printed no failing check, so this`);
    console.log(`            harness cannot say WHICH decision it defends. A defect here, not`);
    console.log(`            evidence about the code. Its output:`);
    r.out.split("\n").filter(Boolean).slice(-6).forEach((l) => console.log(`              ${l}`));
    problems++;
    continue;
  }
  if (!r.red.length) {
    console.log(`  UNCAUGHT  ${m.name}\n            nothing failed — this decision is undefended.`);
    problems++;
    continue;
  }
  const key = r.red.join("|");
  if (seen.has(key)) {
    console.log(`  DUPLICATE ${m.name}\n            identical red set to "${seen.get(key)}".`);
    problems++;
    continue;
  }
  seen.set(key, m.name);
  console.log(`  killed    ${m.name}  → ${r.red.length} red`);
  for (const t of r.red.slice(0, 2)) console.log(`              · ${t}`);
}

console.log("");
if (problems) {
  console.error(`::error::${problems} mutation(s) uncaught, indistinguishable or never applied.`);
  process.exit(1);
}
console.log(`✓ ${MUTATIONS.length} mutations, 0 uncaught, 0 identical red sets.`);

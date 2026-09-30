#!/usr/bin/env node
/**
 * Run ONE shard of the workspace test suite (F080.5).
 *
 *     node scripts/run-test-shard.mjs bin-3
 *
 * WHY THIS EXISTS RATHER THAN `turbo run test --filter=...` IN THE YAML: a shard
 * that runs NOTHING exits 0. That is the same shape that let @broberg/sso 0.2.1
 * ship broken — `vitest -t` exits 0 when it matches nothing — and cardmem
 * measured it twice in their own repo (F269, F269.2), where 170 and 56 tests
 * stopped running while the gate stayed green the whole time.
 *
 * So the run is not trusted on its exit code alone. It is trusted on turbo's own
 * machine-readable summary, and the assertion is SET EQUALITY: the packages that
 * actually ran a `test` task must be exactly the packages this shard names.
 *
 * Set equality rather than a count floor, deliberately. A floor ("at least N")
 * catches a shard that collapsed to nothing; it does not catch a shard that ran
 * seven packages when it should have run seven OTHER packages. Identity catches
 * both, and it cannot pass vacuously.
 *
 * READ THE SUMMARY, NOT THE STDOUT. turbo colours its output, so a regex over
 * the human-readable lines matches nothing the moment CI turns colour on — this
 * repo lost a release to exactly that on 2026-09-20, where a counter read the
 * escape codes and therefore always found zero.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const SHARD_FILE = "scripts/test-shards.json";
const RUNS_DIR = ".turbo/runs";

const wanted = process.argv[2];
const { shards } = JSON.parse(readFileSync(SHARD_FILE, "utf8"));
const names = shards.map((s) => s.name);

if (!wanted) {
  console.error(`usage: node ${process.argv[1]} <shard>\nknown shards: ${names.join(", ")}`);
  process.exit(2);
}

const shard = shards.find((s) => s.name === wanted);
if (!shard) {
  // ABORT, never an empty run. A typo in a JSON file is the easiest possible way
  // to switch a shard off, so the failure has to be loud AND self-correcting:
  // printing the valid names means the reader does not have to open the file.
  console.error(`ABORT: no shard named "${wanted}" in ${SHARD_FILE}`);
  console.error(`known shards: ${names.join(", ")}`);
  process.exit(1);
}

const expected = [...shard.packages].sort();
console.log(`shard ${shard.name}: ${expected.length} packages, ~${shard.weight_seconds}s measured CPU`);

// A stale summary from an earlier run would be picked up as this run's evidence.
rmSync(RUNS_DIR, { recursive: true, force: true });
// A report left by an earlier run would vouch for a run that tested nothing.
// On a turbo cache hit the report is restored as a declared output (turbo.json),
// so deleting it here never loses a real one.
for (const p of expected) {
  rmSync(join("packages", p.replace(/^@broberg\//, ""), ".vitest-report"), { recursive: true, force: true });
}

const filters = expected.flatMap((p) => ["--filter", p]);
let runFailed = false;
try {
  execFileSync("pnpm", ["turbo", "run", "test", "--summarize", ...filters], { stdio: "inherit" });
} catch {
  runFailed = true; // reported below, AFTER the coverage assertion has had its say
}

const runs = readdirSync(RUNS_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => join(RUNS_DIR, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

if (runs.length === 0) {
  console.error(`ABORT: turbo wrote no run summary to ${RUNS_DIR} — cannot prove what ran.`);
  process.exit(1);
}

const summary = JSON.parse(readFileSync(runs[0], "utf8"));
const ran = [...new Set(summary.tasks.filter((t) => t.task === "test").map((t) => t.package))].sort();

const missing = expected.filter((p) => !ran.includes(p));
const extra = ran.filter((p) => !expected.includes(p));

if (missing.length || extra.length) {
  console.error(`\nABORT: this shard did not run what it names.`);
  console.error(`  expected ${expected.length}: ${expected.join(", ")}`);
  console.error(`  actually ran ${ran.length}: ${ran.join(", ") || "(nothing)"}`);
  if (missing.length) console.error(`  NEVER RAN: ${missing.join(", ")}`);
  if (extra.length) console.error(`  ran but not listed: ${extra.join(", ")}`);
  process.exit(1);
}

// F080.6 — a package that RAN is not a package that TESTED. Measured 30/9: a
// package whose tests are all skipped, or whose script carries a -t filter that
// matches nothing, exits 0 having executed ZERO tests — turbo records it as run
// and green, and the set equality above is satisfied by a package that tested
// nothing. (A config matching no FILE is different: vitest exits 1 on its own.)
// The count comes from vitest's JSON reporter (every package's test script
// writes .vitest-report/*.json), never from the human-readable line: CI colours
// that line, and a regex over it read escape codes as "0 tests" on 2026-09-20.
//
// The floor is a ZERO-DETECTOR, set far below the measured count on purpose. A
// floor pinned at today's number reddens the day someone legitimately deletes a
// test, and a gate that cries wolf is a gate somebody deletes.
const floors = shard.min_tests ?? {};
const short = [];
for (const p of expected) {
  const dir = join("packages", p.replace(/^@broberg\//, ""), ".vitest-report");
  let executed = 0;
  let reports = 0;
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      executed += r.numPassedTests + r.numFailedTests;
      reports++;
    }
  } catch {
    // no report directory: reported below as 0 executed, 0 reports
  }
  const floor = floors[p];
  if (floor === undefined) short.push(`${p}: no min_tests floor in ${SHARD_FILE}`);
  else if (reports === 0) short.push(`${p}: wrote NO vitest JSON report — cannot prove it tested anything`);
  else if (executed < floor) short.push(`${p}: executed ${executed} tests, floor is ${floor}`);
}

// Checked BEFORE the failure exit on purpose: when vitest finds no test file it
// exits 1, and "tests FAILED" alone would not say which package stopped testing.
if (short.length) {
  console.error(`\nABORT: ${short.length} package(s) ran but did not TEST enough to count as tested:`);
  for (const s of short) console.error(`  ${s}`);
  console.error(`  Measured: every test skipped, or a -t filter that matches nothing, exits 0 with 0 executed.`);
  process.exit(1);
}

if (runFailed) {
  console.error(`\nshard ${shard.name}: tests FAILED (all ${ran.length} packages did run).`);
  process.exit(1);
}

console.log(`\nshard ${shard.name}: ${ran.length} of ${expected.length} packages ran, passed, and each executed at least its floor.`);

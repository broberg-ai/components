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

if (runFailed) {
  console.error(`\nshard ${shard.name}: tests FAILED (all ${ran.length} packages did run).`);
  process.exit(1);
}

console.log(`\nshard ${shard.name}: ${ran.length} of ${expected.length} packages ran and passed.`);

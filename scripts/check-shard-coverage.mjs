#!/usr/bin/env node
/**
 * Every package with a test script belongs to exactly one shard (F080.5).
 *
 * Runs inside `pnpm test`, so a package added tomorrow cannot quietly fall
 * outside the gate. Without this, scripts/test-shards.json is a list somebody
 * has to remember to update — and the failure of remembering is silent: the new
 * package's tests simply never run, and every shard stays green.
 *
 * cardmem measured that exact outcome twice (F269, F269.2): apps/web with 170
 * tests and apps/lens-cloud with 56 stopped running, and nothing went red.
 *
 * FOUR ASSERTIONS, and the last one is the one that makes the others mean
 * anything:
 *   1. no package with a test script is missing from the shard file
 *   2. no shard names a package that does not exist (or has no test script)
 *   3. no package appears in two shards — it would be built and tested twice,
 *      and the balance the bins were measured for would be wrong
 *   4. REACH CONTROL: the scan found packages at all
 *
 * (4) exists because (1)-(3) all pass vacuously on an empty scan. Point
 * packages/ somewhere that does not exist and every assertion above is
 * satisfied by having nothing to check — a green run that never looked. This is
 * cardmem's contribution and it is the half I did not think of.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PACKAGES_DIR = "packages";
const SHARD_FILE = "scripts/test-shards.json";

// The floor is deliberately far BELOW the real count (40 today). It is a
// did-this-run-at-all detector, not a pinned number — a floor set at the
// measured value goes red the day somebody legitimately removes a package, and
// a check that cries wolf is a check that gets deleted.
const REACH_FLOOR = 10;

// THE WRONG-CWD CASE IS THE ONE THIS GUARD EXISTS FOR, and it used to be the one
// it could not report: readdirSync throws ENOENT with a raw Node stack, so the
// reader got a trace instead of the sentence below that asks whether they are in
// the repo root. Found by reviewing this file's own diff (F080.5), and it is the
// same shape the file is about — a check whose message never reaches the person
// it was written for. Absent and empty are BOTH reach failures, and they are
// reported as such rather than one being an error and the other a finding.
const entries = existsSync(PACKAGES_DIR) ? readdirSync(PACKAGES_DIR) : [];

const withTests = [];
for (const dir of entries) {
  const manifest = join(PACKAGES_DIR, dir, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (pkg.scripts?.test) withTests.push(pkg.name);
}

const problems = [];

if (withTests.length < REACH_FLOOR) {
  const why = existsSync(PACKAGES_DIR)
    ? `found only ${withTests.length} packages with a test script under ${PACKAGES_DIR}/`
    : `there is no ${PACKAGES_DIR}/ directory here at all`;
  problems.push(
    `REACH CONTROL FAILED: ${why} (floor is ${REACH_FLOOR}). Every other check below would pass ` +
      `on an empty list, so this run proves nothing. Are you in the repo root?`,
  );
}

const { shards } = JSON.parse(readFileSync(SHARD_FILE, "utf8"));
const seen = new Map(); // package -> [shard names]
for (const s of shards) {
  for (const p of s.packages) {
    seen.set(p, [...(seen.get(p) ?? []), s.name]);
  }
}

const orphans = withTests.filter((p) => !seen.has(p));
if (orphans.length) {
  problems.push(
    `${orphans.length} package(s) have a test script but belong to NO shard, so their tests never run in CI:\n` +
      orphans.map((p) => `    ${p}`).join("\n") +
      `\n  Add each to a "packages" array in ${SHARD_FILE} (pick the bin with the lowest weight_seconds).`,
  );
}

const ghosts = [...seen.keys()].filter((p) => !withTests.includes(p));
if (ghosts.length) {
  problems.push(
    `${SHARD_FILE} names ${ghosts.length} package(s) that do not exist or have no test script:\n` +
      ghosts.map((p) => `    ${p}`).join("\n") +
      `\n  A shard that names a ghost runs fewer packages than it claims to.`,
  );
}

const duplicated = [...seen.entries()].filter(([, where]) => where.length > 1);
if (duplicated.length) {
  problems.push(
    `${duplicated.length} package(s) appear in more than one shard:\n` +
      duplicated.map(([p, where]) => `    ${p} → ${where.join(", ")}`).join("\n"),
  );
}

// F080.6 — every covered package needs a test-count floor next to its name, and
// its test script must write the vitest JSON report the floor is checked
// against. Without the floor a new package is uncovered by the very check meant
// to cover it; without the report, the shard runner can prove nothing.
const REPORT_FLAG = "--outputFile.json=.vitest-report/";
const noFloor = [];
for (const s of shards) {
  for (const p of s.packages) {
    const f = s.min_tests?.[p];
    if (!Number.isInteger(f) || f < 1) noFloor.push(`${p} (${s.name})`);
  }
}
if (noFloor.length) {
  problems.push(
    `${noFloor.length} package(s) have no min_tests floor (a positive integer) in their shard:\n` +
      noFloor.map((p) => `    ${p}`).join("\n") +
      `\n  Add it under that shard's "min_tests" — about half the package's measured test count.`,
  );
}
const noReport = [];
for (const dir of entries) {
  const manifest = join(PACKAGES_DIR, dir, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (pkg.scripts?.test && !pkg.scripts.test.includes(REPORT_FLAG)) noReport.push(pkg.name);
}
if (noReport.length) {
  problems.push(
    `${noReport.length} package(s) have a test script that writes no vitest JSON report:\n` +
      noReport.map((p) => `    ${p}`).join("\n") +
      `\n  Start the script with: vitest run --reporter=default --reporter=json ${REPORT_FLAG}results.json`,
  );
}

if (problems.length) {
  console.error("shard coverage FAILED:\n");
  for (const p of problems) console.error(`  • ${p}\n`);
  process.exit(1);
}

console.log(
  `shard coverage ok: ${withTests.length} packages with a test script, all covered by ` +
    `${shards.length} shards, no overlaps, every one with a test-count floor and a JSON report.`,
);

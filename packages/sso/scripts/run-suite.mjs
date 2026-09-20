#!/usr/bin/env node
/**
 * Run a NAMED slice of the suite and prove it actually ran.
 *
 *     node scripts/run-suite.mjs "<test name filter>" <minimum expected>
 *
 * ── WHY THIS IS NOT THREE LINES OF SHELL ─────────────────────────────────
 *
 * It was, and it blocked the release that fixed a broken login. `vitest -t`
 * EXITS 0 WHEN IT MATCHES NOTHING, so the count has to be asserted — that part
 * was right. The count was scraped out of the human-readable summary with a
 * regex, and in CI vitest colourises that line: the bytes are
 * `Tests  <esc>[1m<esc>[32m5 passed`, so `Tests +[0-9]+ passed` matched nothing
 * and the guard reported "ran 0" about a run where five tests had just passed.
 *
 * A guard that fails for a reason that has nothing to do with what it guards is
 * worse than no guard: it blocks real work and teaches everyone to route around
 * it. So the count comes from the JSON reporter — a number in a field, not a
 * number in a sentence somebody may decide to paint.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [filter, minimum] = process.argv.slice(2);
if (!filter || !minimum) {
  console.error('usage: run-suite.mjs "<name filter>" <minimum expected>');
  process.exit(2);
}

const out = join(mkdtempSync(join(tmpdir(), "suite-")), "r.json");
let failed = false;
try {
  execFileSync("npx", ["vitest", "run", "-t", filter, "--reporter=json", `--outputFile=${out}`], {
    stdio: ["ignore", "inherit", "inherit"],
  });
} catch {
  failed = true; // a real test failure — still read the report, then fail
}

let report;
try {
  report = JSON.parse(readFileSync(out, "utf8"));
} catch {
  console.error(`::error::vitest produced no JSON report for "${filter}" — the run itself did not happen`);
  process.exit(1);
}

const passed = report.numPassedTests ?? 0;
const failedN = report.numFailedTests ?? 0;
console.log(`"${filter}": ${passed} passed, ${failedN} failed (expected at least ${minimum})`);

if (failed || failedN > 0) {
  console.error(`::error::${failedN} test(s) failed in "${filter}"`);
  process.exit(1);
}
if (passed < Number(minimum)) {
  console.error(
    `::error::expected at least ${minimum} tests matching "${filter}", ran ${passed} — ` +
      `the filter no longer matches them, so this step verified nothing`,
  );
  process.exit(1);
}

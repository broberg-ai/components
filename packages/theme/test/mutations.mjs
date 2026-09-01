// F001.13 — the mutation pass for the CSS → DESIGN.md direction.
//
// Every test in this package is green, which on its own means nothing. This
// breaks each decision designTokensFromCss makes, one at a time, and records
// which tests notice.
//
// TWO PROPERTIES: no mutation may go UNCAUGHT, and no two may produce the SAME
// red set — a mutation that reddens everything proves the suite runs, not that
// it discriminates.
//
// EVERY MUTATION ASSERTS ITS ANCHOR FIRST. A substitution that does not match
// leaves the suite green, which reads exactly like a surviving mutant; that
// misreading has cost this repo two false "SURVIVED" reports.
//
//   node test/mutations.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// F081.1 — announce the mutated tree, and PROVE the restore took.
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(HERE, "src/design-md.ts");
const SRC_FOR_GUARD = "src/design-md.ts";

const MUTATIONS = [
  // The classification order IS the design. Name-first drops a duration into the
  // palette of any repo whose conventions differ from ours.
  {
    name: "classify by NAME first instead of by value",
    from: `    if (COLOUR_VALUE.test(value)) {`,
    to: `    if (/colou?r/.test(name)) {`,
  },
  // Our own preset declares --color-x: var(--x). Without this branch the
  // extractor reports ~16 of our own colours as unreadable.
  {
    name: "the @theme bridge is treated as an unreadable value",
    from: `    if (alias && declared.has(alias[1]!)) {`,
    to: `    if (false && alias) {`,
  },
  // An empty-and-happy result: "nothing here" and "nowhere to look" collapse.
  {
    name: "no :root/@theme block returns empty and happy",
    from: `  if (blocks === 0) {`,
    to: `  if (false) {`,
  },
  // The whole second half of the contract. A seed silent about its misses looks
  // complete, and the reader concludes the project has no shadows.
  {
    name: "skipped is emptied — the misses become invisible",
    from: `    skips.set(reason, e);`,
    to: `    void e;`,
  },
  // The rename is silent again: var(--rounded-sm) resolves to nothing after
  // regeneration and nothing says so.
  {
    name: "a renamed token is not reported",
    from: `        if (emitted !== name) renamed.push({ from: name, to: emitted });`,
    to: `        void emitted;`,
  },
  // The bug found by the round-trip invariant, restored: RADIUS_NAME accepts
  // --rounded-*, so stripping only `radius` leaves the token named `rounded-sm`.
  {
    name: "only the `radius` prefix is stripped (the --rounded-* bug, restored)",
    from: `      const key = short.replace(/^(radius|rounded)-?/, "") || "DEFAULT";`,
    to: `      const key = short.replace(/^radius-?/, "") || "DEFAULT";`,
  },
  // Theme variants merged in would overwrite the base palette with whichever
  // block came last.
  {
    name: "theme variants are read and merged into the base palette",
    from: `const CSS_BLOCK = /(?:@theme|:root)[^{]*\\{([\\s\\S]*?)\\}/g;`,
    to: `const CSS_BLOCK = /(?:@theme|:root|\\[data-theme[^\\]]*\\])[^{]*\\{([\\s\\S]*?)\\}/g;`,
  },
  // F001.14 — substitution removed: a correct alias is echoed into the CSS again.
  {
    name: "an alias is validated but never substituted (the 0.5.0 defect, restored)",
    from: `    const m = ALIAS.exec(current);
    if (!m) return current;`,
    to: `    const m = ALIAS.exec(current);
    if (m) return current;
    if (!m) return current;`,
  },
  // The cycle guard removed: a -> b -> a recurses until the stack dies, and
  // somebody else's RangeError arrives in place of our named error.
  {
    name: "the alias cycle guard is removed (stack overflow instead of a named error)",
    from: `    if (chain.includes(path)) {`,
    to: `    if (false) {`,
  },
  // Validation moved back BEFORE resolution, so an alias pointing at a non-colour
  // is emitted instead of refused.
  {
    name: "the colour check runs on the raw value instead of the resolved one",
    from: `    assertColour(\`colors.\${name}\`, v);`,
    to: `    assertColour(\`colors.\${name}\`, String(value));`,
  },
  // The contrast checker measures the brace string again — culori's TypeError.
  {
    name: "checkContrastAA measures the raw value again (culori's TypeError returns)",
    from: `      const ratio = wcagContrast(resolved[fg]!, resolved[bg]!);`,
    to: `      const ratio = wcagContrast(colors[fg], colors[bg]);`,
  },
];

function redSet() {
  const out = join(HERE, "node_modules/.mutation-report.json");
  // A CRASH REPORTS SUCCESS. Measured 2026-08-29 on @broberg/theme: removing the
  // alias cycle guard made resolveAlias loop forever, node died with
  // "FATAL ERROR: JavaScript heap out of memory" — and vitest still wrote a
  // report saying numFailedTests: 0, success: true, 11/11 passing. Reading only
  // the assertions, this harness called a load-bearing guard UNDEFENDED.
  //
  // So the exit code is kept, and a stale report can never stand in for a fresh
  // one. A measuring instrument that cannot tell "nothing broke" from "the run
  // never finished" is the same success-shaped non-answer it exists to find.
  rmSync(out, { force: true });
  let code = 0;
  try {
    execFileSync("npx", ["vitest", "run", "--reporter=json", "--outputFile", out], {
      cwd: HERE,
      stdio: "pipe",
    });
  } catch (err) {
    code = typeof err?.status === "number" ? err.status : 1;
  }
  if (!existsSync(out)) return [`<the suite wrote no report at all — exit ${code}>`];
  const report = JSON.parse(readFileSync(out, "utf8"));
  const failed = [];
  for (const suite of report.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) if (t.status === "failed") failed.push(t.fullName);
  }
  // Non-zero exit with nothing failing means the run DIED rather than passed.
  if (!failed.length && code !== 0) failed.push(`<the suite did not complete — exit ${code} (crash, OOM or hang)>`);
  return failed.sort();
}

/**
 * MUTATING AN UNCOMMITTED FILE IS UNRECOVERABLE, and it nearly shipped a broken
 * package on 2026-08-29.
 *
 * This harness writes the source, runs the suite, and restores it in a `finally`.
 * `finally` does not run on a KILL. Two runs were killed that day — one on a
 * timeout, one by the session — and each left its mutation in place. Worse, the
 * second run then read the ALREADY-MUTATED file as its "original" and layered
 * its own on top, so the file ended up carrying two disabled guards. Mutated
 * source is indistinguishable from working source by reading; it was caught only
 * because a test happened to fail and I went looking.
 *
 * On a COMMITTED file every one of those states is `git checkout -- <file>`. So
 * the harness refuses to start otherwise. It costs one commit and removes the
 * whole class.
 */
{
  const dirty = execFileSync("git", ["status", "--porcelain", "--", SRC_FOR_GUARD], {
    cwd: HERE,
    encoding: "utf8",
  }).trim();
  if (dirty) {
    console.error(
      `::error::refusing to mutate an uncommitted file — commit first.\n` +
        `  ${dirty}\n` +
        `  A kill (timeout, Ctrl-C, session stop) skips the restore, and mutated source reads exactly like working source.\n` +
        `  Committed, any interrupted run is recoverable with: git checkout -- <file>`,
    );
    process.exit(1);
  }
}

console.log("baseline (unmutated) …");
const baseline = redSet();
if (baseline.length) {
  console.error(`::error::${baseline.length} tests already fail before any mutation:\n  ${baseline.join("\n  ")}`);
  process.exit(1);
}
console.log("  0 failures — a clean baseline, so every red below is the mutation\n");

const seen = new Map();
let problems = 0;

// BEFORE the first mutation (F081.1). Written after it, the marker would leave
// open the exact window it exists to close.
writeMarker({ harness: "@broberg/theme test/mutations.mjs", file: SRC });
try {
for (const m of MUTATIONS) {
  const original = readFileSync(SRC, "utf8");
  // THE RECEIPT. Without it, a substitution that never matched is reported as a
  // surviving mutant and a load-bearing guard is deleted on the strength of it.
  if (!original.includes(m.from)) {
    console.error(`::error::mutation "${m.name}" did not match its target — the source moved.`);
    problems++;
    continue;
  }
  writeFileSync(SRC, original.replace(m.from, m.to));
  let red;
  try {
    red = redSet();
  } finally {
    writeFileSync(SRC, original);
    // F081.1 — a restore that FAILED is otherwise indistinguishable from one
    // that was not needed. Does not return on mismatch.
    assertRestored({ harness: "@broberg/theme test/mutations.mjs", file: SRC, expected: original });
  }

  const key = red.join("|");
  if (red.length === 0) {
    console.log(`  UNCAUGHT  ${m.name}\n            nothing failed — this decision is undefended.`);
    problems++;
  } else if (seen.has(key)) {
    console.log(`  DUPLICATE ${m.name}\n            identical red set to "${seen.get(key)}".`);
    problems++;
  } else {
    seen.set(key, m.name);
    console.log(`  caught    ${m.name}  → ${red.length} red`);
    for (const t of red.slice(0, 2)) console.log(`              · ${t}`);
  }
}
} finally {
  clearMarker();
}

console.log("");
if (problems) {
  console.error(`::error::${problems} mutation(s) uncaught or indistinguishable.`);
  process.exit(1);
}
console.log(`✓ ${MUTATIONS.length} mutations, 0 uncaught, 0 identical red sets.`);

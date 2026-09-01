// F054.7 — the mutation pass for the adapter option forwarding.
//
// The defect this package shipped was a hand-written option list in each
// adapter that had drifted from the core's. So the mutations reintroduce that
// list, one adapter at a time — if either can carry its own list again without
// a test noticing, the fix is a patch rather than a mechanism.
//
// Guards carried over from @broberg/theme's harness, both learned the expensive
// way on 2026-08-29: refuse to run on an uncommitted file (a killed run leaves
// the source mutated, and mutated source reads exactly like working source),
// delete the report before each run, and KEEP THE EXIT CODE — vitest writes
// `success: true` even when the process dies.
//
//   node test/mutations.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// F081.1 — announce the mutated tree, and PROVE the restore took.
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const REACT = join(HERE, 'src/react.tsx');
const PREACT = join(HERE, 'src/preact.tsx');
const CORE = join(HERE, 'src/index.ts');

/** The 0.2.2 shape, verbatim: four names, and the two that mattered missing. */
const OLD_LIST = `    const updater = createPwaUpdater({
      swUrl: options.swUrl,
      pollIntervalMs: options.pollIntervalMs,
      reloadOnControllerChange: options.reloadOnControllerChange,
      disabled: options.disabled,
    });`;

const MUTATIONS = [
  {
    name: 'the react adapter keeps its own option list again (the 0.2.2 defect)',
    file: REACT,
    from: '    const updater = createPwaUpdater(options);',
    to: OLD_LIST,
  },
  {
    name: 'the preact adapter keeps its own option list again',
    file: PREACT,
    from: '    const updater = createPwaUpdater(options);',
    to: OLD_LIST,
  },
  // The identity the effect is keyed on. Drop it to a constant and a caller who
  // CHANGES an option mid-life silently keeps the old updater.
  {
    name: 'the effect key stops depending on the options',
    file: REACT,
    from: '  const key = optionsKey(options);',
    to: '  const key = "";',
  },
  // The core half: register stops being honoured even when forwarded. The first
  // version of this mutation was syntactically invalid and was "caught" by a
  // CRASH rather than by a test noticing — which the exit-code guard reported
  // honestly as "the suite did not complete" instead of as a red. That is the
  // guard doing its job on its own author.
  {
    name: 'the core ignores register and always registers',
    file: CORE,
    from: '    register = true,',
    to: '    register: _ignored = true,',
  },
];

function redSet() {
  const out = join(HERE, 'node_modules/.mutation-report.json');
  rmSync(out, { force: true });
  let code = 0;
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter=json', '--outputFile', out], {
      cwd: HERE,
      stdio: 'pipe',
    });
  } catch (err) {
    code = typeof err?.status === 'number' ? err.status : 1;
  }
  if (!existsSync(out)) return [`<the suite wrote no report at all — exit ${code}>`];
  const report = JSON.parse(readFileSync(out, 'utf8'));
  const failed = [];
  for (const suite of report.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) if (t.status === 'failed') failed.push(t.fullName);
  }
  if (!failed.length && code !== 0) failed.push(`<the suite did not complete — exit ${code} (crash, OOM or hang)>`);
  return failed.sort();
}

{
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src/'], {
    cwd: HERE,
    encoding: 'utf8',
  }).trim();
  if (dirty) {
    console.error(`::error::refusing to mutate uncommitted files — commit first.\n  ${dirty}`);
    process.exit(1);
  }
}

console.log('baseline (unmutated) …');
const baseline = redSet();
if (baseline.length) {
  console.error(`::error::${baseline.length} tests already fail before any mutation:\n  ${baseline.join('\n  ')}`);
  process.exit(1);
}
console.log('  0 failures — a clean baseline, so every red below is the mutation\n');

const seen = new Map();
let problems = 0;
// BEFORE the first mutation (F081.1). Written after it, the marker would leave
// open the exact window it exists to close.
writeMarker({ harness: "@broberg/pwa test/mutations.mjs", file: MUTATIONS[0].file });
try {
for (const m of MUTATIONS) {
  const original = readFileSync(m.file, 'utf8');
  if (!original.includes(m.from)) {
    console.error(`::error::mutation "${m.name}" did not match its target — the source moved.`);
    problems++;
    continue;
  }
  writeFileSync(m.file, original.replace(m.from, m.to));
  let red;
  try {
    red = redSet();
  } finally {
    writeFileSync(m.file, original);
    // F081.1 — a restore that FAILED is otherwise indistinguishable from one
    // that was not needed. Does not return on mismatch.
    assertRestored({ harness: "@broberg/pwa test/mutations.mjs", file: m.file, expected: original });
  }
  const key = red.join('|');
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
console.log('');
if (problems) {
  console.error(`::error::${problems} mutation(s) uncaught or indistinguishable.`);
  process.exit(1);
}
console.log(`✓ ${MUTATIONS.length} mutations, 0 uncaught, 0 identical red sets.`);

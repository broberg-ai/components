// F074.1 — the mutation pass.
//
// Every test in this package is green, which on its own means nothing: a test
// nobody has watched fail is not a guard. This breaks each decision the release
// makes, one at a time, and records exactly which tests notice.
//
// TWO PROPERTIES, and the second is the one people skip:
//   · no mutation may go UNCAUGHT — a decision nothing tests is undefended;
//   · no two mutations may produce the SAME red set — a mutation that reddens
//     everything only proves the suite runs, not that it discriminates.
//
//   node test/mutations.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('../', import.meta.url).pathname;
const INDEX = join(HERE, 'src/index.ts');

const MUTATIONS = [
  // A SECOND COUNTER APPEARS. This is the whole defect, in one line: the bell
  // reading one number while the badge reads another. xrt81 lived it (F074.27)
  // and paid for it with a test that sent badge=0 and deleted the number it was
  // there to prove.
  {
    name: 'unseenCount stops delegating to the store (a second source of truth)',
    file: INDEX,
    from: "    unseenCount(subjectId) {\n      return store.countUnseen(subjectId);\n    },",
    to: "    unseenCount(_subjectId) {\n      return Promise.resolve(0);\n    },",
  },
  // The ORDER is the product. Announcing concurrently with the write publishes a
  // number for a row that may not exist yet.
  {
    name: 'the announce races the write instead of following it',
    file: INDEX,
    from: "    const clearedIds = await run();\n    return { clearedIds, count: await settle(subjectId) };",
    to: "    const settled = settle(subjectId);\n    const clearedIds = await run();\n    return { clearedIds, count: await settled };",
  },
  // Returning the REQUEST hands the surface a highlight pointing at rows the
  // user never had — including rows belonging to somebody else.
  {
    name: 'markSeen returns the requested ids instead of the transitioned ones',
    file: INDEX,
    from: "    markSeen(subjectId, ids) {\n      return clear(subjectId, () => store.markSeen(subjectId, ids));\n    },",
    to: "    markSeen(subjectId, ids) {\n      return clear(subjectId, async () => [...ids]);\n    },",
  },
  // A failed write that still announces leaves every device showing a number for
  // a row that was never written — the inverse of the defect, equally silent.
  {
    name: 'a failed insert is swallowed and still announces',
    file: INDEX,
    from: "      await store.insert(subjectId, row);",
    to: "      await store.insert(subjectId, row).catch(() => {});",
  },
  // "You read the thing elsewhere, so the notification about it clears" — the
  // rule nothing fails without. Drop the ref check and unrelated rows vanish.
  {
    name: 'markSeenByRef ignores the refId (clears the whole kind)',
    file: INDEX,
    from: "      return transition(subjectId, (r) => r.refId === refId && wanted.has(r.kind));",
    to: "      return transition(subjectId, (r) => wanted.has(r.kind));",
  },
  // A notification with no text is sent, accepted, delivered — and shows nothing.
  {
    name: 'the title guard is removed',
    file: INDEX,
    from: "      if (typeof row?.title !== 'string' || row.title.trim() === '') {",
    to: "      if (false) {",
  },
];

/** The set of failing test names, so two mutations can be compared. */
function redSet() {
  const out = join(HERE, 'node_modules/.mutation-report.json');
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter=json', '--outputFile', out], {
      cwd: HERE,
      stdio: 'pipe',
    });
  } catch {
    /* non-zero exit is the expected case here */
  }
  const report = JSON.parse(readFileSync(out, 'utf8'));
  const failed = [];
  for (const suite of report.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) {
      if (t.status === 'failed') failed.push(t.fullName);
    }
  }
  return failed.sort();
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
    writeFileSync(m.file, original); // restore byte-identically, always
  }

  const key = red.join('|');
  if (red.length === 0) {
    console.log(`  UNCAUGHT  ${m.name}`);
    console.log(`            nothing failed — this decision is undefended.`);
    problems++;
  } else if (seen.has(key)) {
    console.log(`  DUPLICATE ${m.name}`);
    console.log(`            identical red set to "${seen.get(key)}" — the suite does not tell them apart.`);
    problems++;
  } else {
    seen.set(key, m.name);
    console.log(`  caught    ${m.name}  → ${red.length} red`);
    for (const t of red.slice(0, 3)) console.log(`              · ${t}`);
    if (red.length > 3) console.log(`              · …and ${red.length - 3} more`);
  }
}

console.log('');
if (problems) {
  console.error(`::error::${problems} mutation(s) uncaught or indistinguishable.`);
  process.exit(1);
}
console.log(`✓ ${MUTATIONS.length} mutations, 0 uncaught, 0 identical red sets.`);

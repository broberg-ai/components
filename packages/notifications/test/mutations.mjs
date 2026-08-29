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
const SRC_FOR_GUARD = 'src/index.ts';

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
    from: "    const ids = await run();\n    return { ids, count: await settle(subjectId) };",
    to: "    const settled = settle(subjectId);\n    const ids = await run();\n    return { ids, count: await settled };",
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
  // F074.3 — the two halves of a survivable fan-out. The first restores 0.1.0
  // (a dead phone undoes the write); the second makes the failure vanish, which
  // is this package's own defect turned inward.
  {
    name: 'a failing fan-out takes the mutation with it again (0.1.0)',
    file: INDEX,
    from: "    try {\n      await onCountChanged(subjectId, count);\n    } catch (err) {",
    to: "    try {\n      await onCountChanged(subjectId, count);\n    } catch (err) {\n      throw err;",
  },
  {
    name: 'the fan-out failure is swallowed (badge and list disagree, nobody told)',
    file: INDEX,
    from: "      if (onCountChangedError) onCountChangedError(err, subjectId, count);\n      else console.error('[@broberg/notifications] onCountChanged failed', { subjectId, count, err });",
    to: "      void err;",
  },
  // F074.5 — the four decisions removal adds. Each one, broken, is a shipped
  // package that looks like it protects you.
  //
  // The badge stops following a DELETION — the reported defect, restored.
  {
    name: 'remove() skips the recount and announce (the reported defect, restored)',
    file: INDEX,
    from: "  async function drop(subjectId: string, run: () => Promise<string[]>): Promise<RemoveResult> {\n    const { ids, count } = await mutate(subjectId, run);\n    return { removedIds: ids, count };\n  }",
    to: "  async function drop(_subjectId: string, run: () => Promise<string[]>): Promise<RemoveResult> {\n    const ids = await run();\n    return { removedIds: ids, count: 0 };\n  }",
  },
  // The construction warning is the ONLY thing that reaches a consumer who
  // deletes in their own table and never calls remove(). Silence it and the
  // package is back to a conditional guarantee nobody is told about.
  {
    name: 'the construction warning is silenced (the one signal a self-deleting consumer gets)',
    file: INDEX,
    from: "  if (!canRemove) {",
    to: "  if (false) {",
  },
  // canRemove lying is worse than absent: a surface renders a delete control on
  // the strength of it.
  {
    name: 'canRemove reports true regardless of the store',
    file: INDEX,
    from: "  const canRemove = typeof store.remove === 'function' && typeof store.removeAll === 'function';",
    to: "  const canRemove = true;",
  },
  // A silent success is the failure shape this repo has hit five times this
  // week: the caller is told the rows are gone and nothing happened.
  {
    name: 'remove() on a store that cannot remove returns a silent success',
    file: INDEX,
    from: "      const run = store.remove;\n      if (!run) {",
    to: "      const run = store.remove;\n      if (!run) {\n        return { removedIds: [], count: await store.countUnseen(subjectId) };\n      }\n      if (false) {",
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

// F067.5 — the mutation pass.
//
// The suite is green, which alone means nothing. This breaks each decision the
// release makes and records which tests notice. No mutation may go UNCAUGHT (a
// decision nothing defends), and no two may produce the SAME red set — a
// mutation that reddens everything only proves the suite runs.
//
//   node test/mutations.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// F081.1 — announce the mutated tree, and PROVE the restore took.
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const HERE = new URL('../', import.meta.url).pathname;
const INDEX = join(HERE, 'src/index.ts');

const MUTATIONS = [
  {
    name: 'failures are swallowed again (the 0.3.1 behaviour)',
    from: `          failed.push({
            endpoint: s.endpoint,`,
    to: `          if (0) failed.push({
            endpoint: s.endpoint,`,
  },
  {
    name: 'a gone endpoint is ALSO reported as a failure',
    from: `            dead.push(s.endpoint);
            return;`,
    to: `            dead.push(s.endpoint);`,
  },
  {
    name: 'a failure becomes fatal (breaks the never-throws contract)',
    from: `            reason: err instanceof Error ? err.message : String(err),
          });`,
    to: `            reason: err instanceof Error ? err.message : String(err),
          });
          throw err;`,
  },
  {
    name: 'wrong VAPID keys are classified as a transient blip',
    from: `  if (code === 401 || code === 403) return 'auth';`,
    to: `  if (code === 401 || code === 403) return 'transient';`,
  },
  {
    name: 'the status code is absent instead of null',
    from: `            statusCode: code ?? null,`,
    to: `            statusCode: code as number,`,
  },
  {
    name: 'a broken config is a transient blip again (the pre-fix behaviour)',
    from: `      return refuseAll(subs, 'auth', statusReason ?? 'push sender is not configured');`,
    to: `      return refuseAll(subs, 'transient', statusReason ?? 'push sender is not configured');`,
  },
  {
    name: 'the config short-circuit is removed (every send hits the network)',
    from: `    if (status !== 'ready') {`,
    to: `    if (false as boolean) {`,
  },
  {
    name: 'allFailed alarms on ordinary 410 churn',
    from: `    return { sent, dead, failed, allFailed: failed.length > 0 && sent === 0 };`,
    to: `    return { sent, dead, failed, allFailed: sent === 0 };`,
  },
  {
    name: 'a wrong config no longer raises allFailed',
    from: `    return { sent: 0, dead: [], failed, allFailed: failed.length > 0 };`,
    to: `    return { sent: 0, dead: [], failed, allFailed: false };`,
  },
  {
    name: 'not-configured and configured-wrong collapse into one state',
    from: `      status = 'invalid-keys';`,
    to: `      status = 'no-keys';`,
  },
  {
    name: 'the empty-message gate is removed',
    from: `    if (typeof message?.title !== 'string' || message.title.trim() === '') {`,
    to: `    if (false as boolean) {`,
  },
  {
    name: 'the silent path is gated on a title too',
    from: `  const sendSilent = (subs: PushSubscriptionJSON[], message: SilentPushMessage) =>
    fanOut(subs, buildSilentPayload(message));`,
    to: `  const sendSilent = (subs: PushSubscriptionJSON[], message: SilentPushMessage) =>
    refuseAll(subs, 'payload', 'no title') && Promise.resolve(refuseAll(subs, 'payload', 'no title'));`,
  },
  {
    name: 'the declarative form loses the text (classic still carries it)',
    from: `    notification: {
      title: m.title,
      body: m.body,`,
    to: `    notification: {
      title: undefined,
      body: undefined,`,
  },
];

function redSet() {
  const out = join(HERE, 'node_modules/.mutation-report.json');
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter=json', '--outputFile', out], {
      cwd: HERE,
      stdio: 'pipe',
    });
  } catch {
    /* non-zero exit is expected here */
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

// BEFORE the first mutation (F081.1). Written after it, the marker would leave
// open the exact window it exists to close.
writeMarker({ harness: "@broberg/webpush test/mutations.mjs", file: INDEX });
try {
for (const m of MUTATIONS) {
  const original = readFileSync(INDEX, 'utf8');
  if (!original.includes(m.from)) {
    console.error(`::error::mutation "${m.name}" did not match its target — the source moved.`);
    problems++;
    continue;
  }
  writeFileSync(INDEX, original.replace(m.from, m.to));
  let red;
  try {
    red = redSet();
  } finally {
    writeFileSync(INDEX, original); // restore byte-identically, always
    // F081.1 — a restore that FAILED is otherwise indistinguishable from one
    // that was not needed. Does not return on mismatch.
    assertRestored({ harness: "@broberg/webpush test/mutations.mjs", file: INDEX, expected: original });
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
    if (red.length > 2) console.log(`              · …and ${red.length - 2} more`);
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

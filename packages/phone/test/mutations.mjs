// F107.1 — the mutation pass for @broberg/phone. Every decision the package
// makes is broken in turn; no mutation may go UNCAUGHT and no two may produce
// the SAME red set.
//
//   node test/mutations.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const HERE = new URL('../', import.meta.url).pathname;
const INDEX = join(HERE, 'src/index.ts');

const MUTATIONS = [
  { name: 'a webhook with the wrong token is accepted', from: `return t !== null && sameSecret(t, config.webhookSecret!);`, to: `return t !== null;` },
  { name: 'a webhook with NO token is accepted', from: `return t !== null && sameSecret(t, config.webhookSecret!);`, to: `return true;` },
  { name: 'a phone without keys accepts webhooks', from: `if (status !== "ready") return false;`, to: `` },
  { name: 'any key acknowledges', from: `acknowledged: digits === ack,`, to: `acknowledged: digits !== "",` },
  { name: 'busy reported as answered', from: `outcome: state === "success" ? "answered" : state,`, to: `outcome: state === "failed" ? "failed" : "answered",` },
  { name: 'neverAnswered ignores the pickup time', from: `neverAnswered: !field(body, "start"),`, to: `neverAnswered: false,` },
  { name: 'the number is not masked in a failure reason', from: `(to \${maskNumber(to)})\` };`, to: `(to \${to})\` };` },
  { name: '401 treated as transient', from: `if (status === 401 || status === 403) return "auth";`, to: `` },
  { name: 'ship-dark still sends', from: `if (status !== "ready") return { ok: false, kind: "auth", statusCode: null, reason: status === "no-keys" ? "no-keys" : \`invalid-keys: \${statusReason}\` };`, to: `` },
  { name: 'a 200 without a call id counts as success', from: `if (!id) return { ok: false, kind: "transient", statusCode: r.status, reason: "46elks answered without a call id" };`, to: `if (!id) return { ok: true, callId: "" };` },
  { name: 'the key-press wait is not clamped', from: `timeout: Math.min(30, Math.max(1, o.inputTimeoutSeconds ?? 10)),`, to: `timeout: o.inputTimeoutSeconds ?? 10,` },
  { name: 'whenhangup is left out — no word when the call never connects', from: `, whenhangup: hook("hangup") });`, to: ` });` },
  { name: 'a short webhook secret is accepted', from: `else if (config.webhookSecret!.length < 16)`, to: `else if (false)` },
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
writeMarker({ harness: "@broberg/phone test/mutations.mjs", file: INDEX });
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
    assertRestored({ harness: "@broberg/phone test/mutations.mjs", file: INDEX, expected: original });
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

// F106.1 — the mutation pass for @broberg/nativepush.
//
// The suite is green, which alone means nothing. This breaks each decision the
// sender makes and records which tests notice. No mutation may go UNCAUGHT, and
// no two may produce the SAME red set.
//
//   node test/mutations.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const HERE = new URL('../', import.meta.url).pathname;
const INDEX = join(HERE, 'src/index.ts');

const MUTATIONS = [
  { name: 'APNs 410 Unregistered is no longer dead', from: `if (status === 410) return "dead";`, to: `if (status === 410) return "transient";` },
  { name: 'APNs BadDeviceToken (400) becomes dead — would empty a table on a sandbox/production mix-up', from: `if (status === 400 || status === 404`, to: `if (status === 400) return "dead";\n  if (status === 404` },
  { name: 'FCM UNREGISTERED is no longer dead', from: `if (code === "UNREGISTERED") return "dead";`, to: `` },
  { name: 'FCM 403 (SENDER_ID_MISMATCH) treated as payload', from: `if (status === 401 || status === 403) return "auth";\n  if (status === 400 || status === 404) return "payload";`, to: `if (status === 400 || status === 403 || status === 404) return "payload";` },
  { name: 'ES256 signature in DER instead of raw r||s', from: `ecdsa ? { key, dsaEncoding: "ieee-p1363" } : key`, to: `key` },
  { name: 'APNs provider token re-minted on every send', from: `if (apnsJwt && t - apnsJwt.at < 50 * 60 * 1000) return apnsJwt.token;`, to: `` },
  { name: 'FCM access token fetched on every send', from: `if (fcmToken && t < fcmToken.until) return fcmToken.token;`, to: `` },
  { name: 'ship-dark swallows the targets instead of reporting them', from: `for (const tg of targets) fail(tg, null, "auth", apnsStatus === "no-keys" ? "no-keys" : \`invalid-keys: \${apnsReason}\`);`, to: `` },
  { name: 'an RSA key is accepted as an APNs .p8', from: `if (k.asymmetricKeyType !== "ec") throw`, to: `if (false) throw` },
  { name: 'allFailed true even when tokens were merely dead', from: `out.allFailed = out.failed.length > 0 && out.sent === 0 && out.dead.length === 0;`, to: `out.allFailed = out.sent === 0;` },
  { name: 'critical sound loses its critical flag', from: `? { critical: 1, name:`, to: `? { critical: 0, name:` },
  { name: 'data-only still sends a notification block', from: `...(dataOnly || (m.title === undefined && m.body === undefined) ? {}`, to: `...((m.title === undefined && m.body === undefined) ? {}` },
  { name: 'passive is sent at priority 10', from: `m.level === "passive" ? "5" : "10"`, to: `"10"` },
  { name: 'token endpoint refusal reported as transient', from: `sc !== null && sc >= 400 && sc < 500 && sc !== 429 ? "auth" : "transient"`, to: `"transient"` },
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
writeMarker({ harness: "@broberg/nativepush test/mutations.mjs", file: INDEX });
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
    assertRestored({ harness: "@broberg/nativepush test/mutations.mjs", file: INDEX, expected: original });
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

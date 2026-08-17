// F071.1 — the mutation pass.
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
const SCHEMA = join(HERE, 'src/schema.ts');
const FLOW = join(HERE, 'src/flow.ts');

const MUTATIONS = [
  {
    name: 'step .strict() → .strip() (Zod default)',
    file: SCHEMA,
    from: "  z.object({ ...shape, timeout_ms: timeoutMsSchema.optional() }).strict();",
    to: "  z.object({ ...shape, timeout_ms: timeoutMsSchema.optional() });",
  },
  {
    name: 'body .strict() → .strip() (Zod default)',
    file: SCHEMA,
    from: "  .strict();\nexport type FlowBody",
    to: "  ;\nexport type FlowBody",
  },
  {
    name: 'the inlet is closed again (back to a hardcoded default)',
    file: FLOW,
    from: "  const timeoutMs = resolveStepTimeout({}, body);",
    to: "  const timeoutMs = DEFAULT_TIMEOUT_MS;",
  },
  {
    name: 'precedence inverted (flow beats step)',
    file: FLOW,
    from: "  return step.timeout_ms ?? flow.timeout_ms ?? DEFAULT_TIMEOUT_MS;",
    to: "  return flow.timeout_ms ?? step.timeout_ms ?? DEFAULT_TIMEOUT_MS;",
  },
  {
    name: 'timeout_ms accepts 0 (which Playwright reads as "never time out")',
    file: SCHEMA,
    from: "const timeoutMsSchema = z.number().int().min(1).max(60_000);",
    to: "const timeoutMsSchema = z.number().int().min(0).max(60_000);",
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

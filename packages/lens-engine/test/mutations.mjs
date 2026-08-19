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
const CAPTURE = join(HERE, 'src/capture.ts');

const MUTATIONS = [
  {
    name: 'step .strict() → .strip() (Zod default)',
    file: SCHEMA,
    from: "    .object({ ...shape, timeout_ms: timeoutMsSchema.optional() }, { errorMap: unknownKeyHint('step') })\n    .strict();",
    to: "    .object({ ...shape, timeout_ms: timeoutMsSchema.optional() }, { errorMap: unknownKeyHint('step') });",
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
  // F071.2 — the two halves of the bare-tag fix, and they must redden DIFFERENT
  // sets. Removing the hint restores the silence the story exists to end;
  // teaching the heuristic about tag names would end the silence too, by
  // breaking every consumer whose data-testid IS an element name.
  {
    name: 'the bare-tag hint is removed (back to the silence)',
    file: FLOW,
    from: "  if (!isBareTagName(original)) return null;",
    to: "  if (!isBareTagName(original)) return null;\n  return null;",
  },
  {
    name: 'the heuristic is taught tag names (silent miss traded for a breaking change)',
    file: CAPTURE,
    from: "  const looksLikeCss = /[.#\\[\\]:>~+*()=\"' ]/.test(selector);\n  return looksLikeCss ? selector : `[data-testid=\"${selector}\"]`;",
    to: "  const looksLikeCss = /[.#\\[\\]:>~+*()=\"' ]/.test(selector);\n  return looksLikeCss || isBareTagName(selector) ? selector : `[data-testid=\"${selector}\"]`;",
  },
  // F071.3 — the .extend() hint. Two halves: removing it restores the message
  // that named the key and stopped there, and firing it on every issue turns a
  // hint into noise that nobody reads.
  {
    name: 'the .extend() hint is removed (back to Zod\'s bare message)',
    file: SCHEMA,
    from: "    if (issue.code !== z.ZodIssueCode.unrecognized_keys) return { message: ctx.defaultError };",
    to: "    if (issue.code !== z.ZodIssueCode.unrecognized_keys) return { message: ctx.defaultError };\n    return { message: ctx.defaultError };",
  },
  {
    name: 'the hint fires on EVERY issue, not just an unknown key',
    file: SCHEMA,
    from: "    if (issue.code !== z.ZodIssueCode.unrecognized_keys) return { message: ctx.defaultError };\n    const named",
    to: "    const named",
  },
  // The hint must stay conditional on a REAL zero-match. Attaching it to every
  // failure of a tag-named target makes it noise, and noise stops being read.
  {
    name: 'the hint fires without checking the match count',
    file: FLOW,
    from: "  if (count !== 0) return err;",
    to: "  if (count === -2) return err;",
  },
  // F071.4 — the patient resolve. Each of these is a way the fix could look
  // landed and not be.
  {
    name: 'pass 2 removed (back to the snapshot-only defect)',
    file: FLOW,
    from: "  if (attempts.length === 0) return null;",
    to: "  if (attempts.length >= 0) return null;",
  },
  {
    name: 'pass 2 serialised per layer (a miss costs n x timeout)',
    file: FLOW,
    from: `    const winner = await Promise.any(
      attempts.map(async (a) => {
        const loc = a.make().nth(nth);
        await loc.waitFor({ state, timeout: timeoutMs });
        return { locator: loc, layer: a.layer };
      }),
    );`,
    to: `    const winner = await (async () => {
      for (const a of attempts) {
        const loc = a.make().nth(nth);
        try {
          await loc.waitFor({ state, timeout: timeoutMs });
          return { locator: loc, layer: a.layer };
        } catch {
          /* next layer — and this is the regression: each one pays in full */
        }
      }
      throw new Error('all layers missed');
    })();`,
  },
  {
    name: 'upload loses its exemption (hidden file inputs break fleet-wide)',
    file: FLOW,
    from: "  return action === 'upload' ? 'attached' : 'visible';",
    to: "  return 'visible';",
  },
  {
    name: 'pass 1 counts hidden elements again (self-heal stops healing)',
    file: FLOW,
    from: "      const hit = state === 'visible' ? await loc.isVisible() : (await base.count()) > nth;",
    to: "      const hit = (await base.count()) > nth;",
  },
  {
    name: 'the remaining-budget floor is removed (0 means WAIT FOREVER)',
    file: FLOW,
    from: "  return Math.max(1, budget - spent);",
    to: "  return budget - spent;",
  },
  {
    name: 'the verb waits on the ORIGINAL budget again (F074.51, 2N)',
    file: FLOW,
    from: "      await locator.click({ timeout: remaining_ms });",
    to: "      await locator.click({ timeout: timeoutMs });",
  },
  // F071.5 — the race decides WHEN, the snapshot decides WHICH. Break each half
  // separately: the first restores 0.8.0 (whoever settles first wins), the second
  // corrupts the ordering itself and so must also redden pass 1.
  {
    name: 'the race decides WHICH layer again (0.8.0 — first to settle wins)',
    file: FLOW,
    from: "    return (await snapshotByPriority(attempts, state, nth)) ?? winner;",
    to: "    return winner;",
  },
  // F073.3 — the matcher, the message, and the two rules absence obeys.
  {
    name: 'waitForUrl adopts Playwright glob (29 real runs change meaning)',
    file: FLOW,
    from: "        await page.waitForURL((u) => urlMatches(want, u.toString()), { timeout: timeoutMs });",
    to: "        await page.waitForURL(want, { timeout: timeoutMs });",
  },
  {
    name: 'the URL matcher becomes exact equality (37 of 38 real arguments die)',
    file: FLOW,
    from: "export function urlMatches(want: string, url: string): boolean {\n  return url.includes(want);",
    to: "export function urlMatches(want: string, url: string): boolean {\n  return url === want;",
  },
  {
    name: 'waitForUrl stops saying WHERE the page actually is',
    file: FLOW,
    from: "        throw new Error(`waitForUrl: never reached a URL containing \"${want}\" — still at ${page.url()}`);",
    to: "        throw new Error(`waitForUrl: never reached a URL containing \"${want}\"`);",
  },
  {
    name: 'expectAbsent ignores nth (\"the third row\" becomes \"any row\")',
    file: FLOW,
    from: "          if (visible > nth) present.push(l.layer);",
    to: "          if (visible > 0) present.push(l.layer);",
  },
  {
    name: 'expectAbsent passes when ANY layer is gone, not when all are',
    file: FLOW,
    from: "        if (present.length === 0) return { detail: describeTarget(step.target) };",
    to: "        if (present.length < layers.length) return { detail: describeTarget(step.target) };",
  },
  // F071.6 — the label that could not contradict the caller.
  {
    name: 'the step label names the spec\'s first key again, not the layer that hit',
    file: FLOW,
    from: "  const value = layerValue(t, layer);\n  return value === null ? describeTarget(t) : `${value} (${layer})`;",
    to: "  return describeTarget(t);",
  },
  // F073.2 — the three decisions check/uncheck make. The first is the repair
  // this story exists to refuse; the other two are what turns a failure into a
  // one-line fix instead of a hunt.
  {
    name: 'check falls back to a click (the forbidden repair)',
    file: FLOW,
    from: "        if (step.action === 'check') await locator.check({ timeout: remaining_ms });",
    to: "        if (step.action === 'check') await locator.click({ timeout: remaining_ms });",
  },
  {
    name: 'the not-checkable hint fires on EVERY failure',
    file: FLOW,
    from: "  if (!/checkbox or radio/i.test(message)) return err;",
    to: "  if (false) return err;",
  },
  {
    name: 'describeElement drops an empty attribute VALUE (absent and blank collapse)',
    file: FLOW,
    from: "      return v === null ? null : `${a}=\"${v}\"`;",
    to: "      return v ? `${a}=\"${v}\"` : null;",
  },
  {
    name: 'the priority order is reversed (text beats testid)',
    file: FLOW,
    from: "  for (const a of attempts) {\n    try {\n      const base = a.make();",
    to: "  for (const a of [...attempts].reverse()) {\n    try {\n      const base = a.make();",
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

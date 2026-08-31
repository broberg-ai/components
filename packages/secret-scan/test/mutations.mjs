// F035.11 — the mutation pass for the announced axis.
//
// Two properties: no mutation may go UNCAUGHT, and no two may produce the SAME
// red set — a mutation that reddens everything proves the suite runs, not that
// it discriminates.
//
// THREE THINGS THIS HARNESS DOES THAT A NAIVE ONE DOES NOT, all learned the
// expensive way on 2026-08-29 in @broberg/theme:
//   · it REFUSES to run on an uncommitted file — `finally` does not run on a
//     kill, and a killed run leaves the source mutated, which reads exactly like
//     working source;
//   · it deletes the report before each run, so a stale one cannot stand in for
//     a fresh pass;
//   · it keeps the EXIT CODE. vitest writes `success: true` even when the
//     process dies, so a crashed suite otherwise reads as "nothing failed" and a
//     load-bearing guard gets reported as undefended.
//
// WHAT THIS HARNESS CANNOT MUTATE, so nobody wastes an hour on a false uncaught:
// anything whose test reads `dist/`. It rewrites src and re-runs vitest WITHOUT
// rebuilding, so test/shipped-types.test.ts (which asserts on the published
// .d.ts) would read the previous build and stay green — reported as UNCAUGHT
// while the seal is in fact working. That seal's red was proven directly
// instead: see 0.7.1, where it caught the fix's own first draft.
//
//   node test/mutations.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(HERE, 'src/index.ts');
const SRC_FOR_GUARD = 'src/index.ts';

const MUTATIONS = [
  // The whole defect, restored: every candidate is plausible again.
  {
    name: 'the plausibility test always says yes (the 0.5.1 defect, restored)',
    from: '  return /\\d/.test(candidate) || candidate.length >= 16;',
    to: '  return candidate.length >= 0;',
  },
  // The opposite failure, and it is just as bad: the axis stops protecting.
  {
    name: 'the plausibility test always says no (the axis is silently useless)',
    from: '        if (!core || !plausibleSecretValue(core)) return match;',
    to: '        if (true) return match;',
  },
  // Only the digit half. `hunter2` still goes; a long digit-free password stays.
  {
    name: 'only the digit rule survives (length alone no longer qualifies)',
    from: '  return /\\d/.test(candidate) || candidate.length >= 16;',
    to: '  return /\\d/.test(candidate);',
  },
  // Only the length half. A long value goes; `hunter2` — the documented case —
  // is silently left in the text.
  {
    name: 'only the length rule survives (the documented hunter2 case leaks)',
    from: '  return /\\d/.test(candidate) || candidate.length >= 16;',
    to: '  return candidate.length >= 16;',
  },
  // THE THRESHOLD ITSELF. Measured before the boundary fixtures existed: this
  // exact mutation left all 178 tests green, so the 16 could have sat anywhere
  // in a nine-character window unnoticed.
  {
    name: 'the digit-free floor moves by one (16 -> 17)',
    from: '  return /\\d/.test(candidate) || candidate.length >= 16;',
    to: '  return /\\d/.test(candidate) || candidate.length >= 17;',
  },
  // The two entry points disagree about the same input.
  {
    name: 'hasAnnouncedSecret stops agreeing with redactSecrets',
    from: '    if (core && plausibleSecretValue(core)) {',
    to: '    if (true) {',
  },
  // ---- F035.12 -----------------------------------------------------------
  // D1: the delimiters go back to being swallowed into the replaced span.
  {
    name: 'D1 restored — a wrapping delimiter is deleted by the redaction',
    from: "        return prefix + lead + redactionMarker(ANNOUNCED_LABEL) + trail;",
    to: "        return prefix + redactionMarker(ANNOUNCED_LABEL);",
  },
  // D2: the quote between the label and the separator blocks the match again,
  // so a JSON-shaped announcement passes untouched. This is the LEAK.
  {
    name: 'D2 restored — a quoted key is never matched (the JSON leak)',
    from: "|apinøgle|secret|pwd)[\"'`\\]]?\\s*[:=]\\s*)(\\S+)/gi;",
    to: "|apinøgle|secret|pwd)\\s*[:=]\\s*)(\\S+)/gi;",
  },
  // The marker guard: a format-recognised key inside delimiters is flattened to
  // the generic label and the text stops saying what kind of key it was.
  {
    name: 'the already-redacted guard is dropped — a quoted format key is flattened',
    from: '        if (value.includes(MARKER_PREFIX)) return match;',
    to: '        if (false) return match;',
  },
  // THE FLOOR MUTATION, and it exists to keep a fix OUT rather than in.
  // buddy measured the digit branch over 41,095 texts: Sommer2026! is 11
  // characters, and prose in the same band cannot be separated by form. So the
  // branch stays conservative ON PURPOSE. Anyone who "tidies" this by adding a
  // floor gets a red test instead of a leaked password.
  {
    name: 'a floor is introduced on the digit branch (leaks Sommer2026!)',
    from: '  return /\\d/.test(candidate) || candidate.length >= 16;',
    to: '  return (/\\d/.test(candidate) && candidate.length >= 12) || candidate.length >= 16;',
  },
  // valueOnly stops being opt-in: every caller receives the weak guesses,
  // including the surfaces that cannot render uncertainty.
  {
    name: 'the valueOnly gate is removed from classify (guesses become defaults)',
    from: '  if (!opts?.valueOnly) return null;',
    to: '  if (false) return null;',
  },
  // ...and the other direction: the option is accepted and ignored, so beacon
  // opts in and still leaks. A success-shaped non-answer.
  {
    name: 'valueOnly is accepted and IGNORED in redactSecrets',
    from: '  if (opts?.valueOnly) {',
    to: '  if (false) {',
  },
  // The exported regexes go back to carrying /g, so measuring one corrupts it.
  {
    name: 'exported patterns are global again — inspecting one changes its answer',
    from: "      Object.freeze({ ...p, regex: new RegExp(p.regex.source, p.regex.flags.replace('g', '')) }),",
    to: "      Object.freeze({ ...p, regex: new RegExp(p.regex.source, p.regex.flags) }),",
  },
  // DELIBERATELY ABSENT, recorded rather than left as a gap: "a rejected
  // candidate is rebuilt as `prefix + value` instead of returned as `match`".
  // It cannot be killed because it is EQUIVALENT BY CONSTRUCTION — the two
  // capture groups together ARE the whole match, so the two expressions produce
  // the same string for every input. An unkillable mutation is not a hole in the
  // suite; reporting it as UNCAUGHT would be the suite lying about itself. The
  // reason `return match` is still written that way is in a comment beside it.
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
  const dirty = execFileSync('git', ['status', '--porcelain', '--', SRC_FOR_GUARD], {
    cwd: HERE,
    encoding: 'utf8',
  }).trim();
  if (dirty) {
    console.error(
      `::error::refusing to mutate an uncommitted file — commit first.\n  ${dirty}\n` +
        `  A kill skips the restore, and mutated source reads exactly like working source.`,
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
  const original = readFileSync(SRC, 'utf8');
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
console.log('');
if (problems) {
  console.error(`::error::${problems} mutation(s) uncaught or indistinguishable.`);
  process.exit(1);
}
console.log(`✓ ${MUTATIONS.length} mutations, 0 uncaught, 0 identical red sets.`);

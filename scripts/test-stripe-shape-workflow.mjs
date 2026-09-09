#!/usr/bin/env node
/**
 * F053.12 — the daily shape check must not report SUCCESS when it did not run.
 *
 * Found by the review gate on the card that shipped the workflow: the job sets
 * `continue-on-error: true` and then asks only whether the exit code was '1'.
 * A crash — the module failing to load, a rename, a syntax error — produced a
 * GREEN run, i.e. exactly the state this monitor exists to make impossible, one
 * layer up. "Nothing moved" and "we never asked" were the same colour.
 *
 * These assertions are the seal. Each one is written so that undoing the fix
 * turns it red, which is the only property that makes a seal worth having.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(join(ROOT, ".github/workflows/stripe-shape.yml"), "utf8");

// STRIP COMMENTS BEFORE MATCHING. Measured 2026-09-08: with the real crash guard
// deleted and only a COMMENT quoting it left behind, the headline assertion —
// "a crash fails the run" — stayed GREEN, because its pattern matched the `if:`
// line inside the prose. The suite went red only because two NEIGHBOURING checks
// noticed other pieces were missing. A comment that quoted those too would have
// passed all ten.
//
// helpdesk named the general shape an hour earlier, having hit it in their own
// residency guard: their mutation test could not distinguish `regionOfHost(u)
// === "eu"` from `u.includes("mistral")`, because every fixture they had made
// the two agree. A predicate is only tested by a case where the right answer and
// the plausible-wrong answer DIFFER — and a file's own explanation of a pattern
// is not the pattern.
//
// Only whole-line `#` comments are stripped; a `#` inside a value stays, since
// dropping it would change the very directives being asserted.
const wf = raw
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check("the check step still swallows its own exit code (so the guard below is load-bearing)", () => {
  if (!wf.includes("continue-on-error: true")) {
    return "no continue-on-error — if that was removed deliberately, this whole seal needs rewriting rather than deleting";
  }
  return null;
});

check("a crash (any code that is neither 0 nor 1) FAILS the run", () => {
  const guard = /if:\s*steps\.check\.outputs\.code\s*!=\s*'0'\s*&&\s*steps\.check\.outputs\.code\s*!=\s*'1'/;
  if (!guard.test(wf)) {
    return "no step fails the run on an exit code outside {0,1} — a crash reports SUCCESS";
  }
  return null;
});

check("that guard actually exits non-zero rather than only logging", () => {
  const at = wf.search(/if:\s*steps\.check\.outputs\.code\s*!=\s*'0'/);
  if (at === -1) return "guard not found (covered by the previous check)";
  const tail = wf.slice(at);
  if (!/\n\s+exit 1/.test(tail)) {
    return "the crash guard logs but never exits 1 — the run stays green";
  }
  return null;
});

check("the crash message says it is NOT a clean result", () => {
  if (!/::error::.*did not run/i.test(wf)) {
    return "the crash step does not say the check DID NOT RUN — a reader would read the red as drift";
  }
  return null;
});

check("drift still fails the run", () => {
  const hits = wf.match(/if:\s*steps\.check\.outputs\.code\s*==\s*'1'/g) ?? [];
  if (hits.length < 2) {
    return `expected the drift code '1' to gate both the Upmetrics post and the failure step; found ${hits.length}`;
  }
  return null;
});

check("`unknown` does NOT fail the run", () => {
  if (!/status === 'unknown'[\s\S]{0,200}?process\.exit\(0\)/.test(wf)) {
    return "unknown no longer exits 0 — a GitHub blip would redden this daily and the monitor would get switched off";
  }
  return null;
});

check("no dead dist/ fallback (it is never built in this job and is not committed)", () => {
  if (wf.includes("packages/stripe/dist/")) {
    return "the dist/ fallback is back — pnpm install runs no build here and dist/ is gitignored, so it is a safety net that cannot catch anything";
  }
  return null;
});

check("node is pinned at or above the version that can import the .ts source", () => {
  const m = wf.match(/node-version:\s*"?(\d+)(?:\.(\d+))?"?/);
  if (!m) return "no node-version pinned";
  const [major, minor] = [Number(m[1]), Number(m[2] ?? 0)];
  const ok = major > 22 || (major === 22 && minor >= 18);
  if (!ok) {
    return `node-version ${m[1]}.${m[2] ?? 0} cannot import .ts without a flag — the check would crash every day`;
  }
  return null;
});

check("the Upmetrics DSN is passed as env, never interpolated into the command line", () => {
  if (/curl[^\n]*\$\{\{\s*secrets\./.test(wf)) {
    return "a secret is interpolated straight into a shell command — it can leak into a trace";
  }
  if (!/DSN:\s*\$\{\{\s*secrets\.UPMETRICS_DSN\s*\}\}/.test(wf)) {
    return "the DSN is no longer supplied via env";
  }
  return null;
});

check("it ships dark: no DSN means a warning, not a crash", () => {
  if (!/if \[ -z "\$DSN" \][\s\S]{0,200}?exit 0/.test(wf)) {
    return "a missing DSN no longer exits 0 — the monitor would fail on config rather than on Stripe";
  }
  return null;
});

// THREE OUTCOMES HERE TOO, which is the same lesson one level in. `if (problem)`
// treats a check that returned `undefined` — one that fell off its own end, or
// threw and was caught somewhere — as a PASS, byte-identical to one that
// deliberately returned null. That is the failure this whole file exists to
// seal, rebuilt in the file that seals it. trail measured the same shape in
// their deploy-guard test the same evening: 36 green ticks on a guard that was
// not running, because their predicate's silent case defaulted to pass.
//
// So a check must ANSWER: `null` for pass, a string for the problem. Anything
// else is "the check did not run" and fails, loudly and by name.
let failed = 0;
for (const { name, fn } of checks) {
  let problem;
  try {
    problem = fn();
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      the check THREW: ${err.message}`);
    continue;
  }

  if (problem === null) {
    console.log(`  ✓ ${name}`);
  } else if (typeof problem === "string" && problem.length > 0) {
    failed++;
    console.log(`  ✗ ${name}\n      ${problem}`);
  } else {
    failed++;
    console.log(
      `  ✗ ${name}\n      the check DID NOT ANSWER (returned ${JSON.stringify(problem)}) — ` +
        `not a pass. A check must return null or a non-empty reason.`,
    );
  }
}

// A FLOOR, because `failed === 0` is also true of a run that checked NOTHING.
// trail's sharpest measurement of the evening: they copied a guard-test to /tmp
// to compare two versions and both answered "0 passed · 0 failed" — the file
// locates its target relative to itself and could not see it from there. TWO
// IDENTICAL ZEROES, which is the one shape where "did not run" looks like a
// result in both directions at once. They caught it only because 0/0 was absurd
// for that suite; for a suite that legitimately has few cases it would not be.
//
// The floor is the population, not the outcome — every guard in this file asks
// "did the check answer?", and this one asks "was there anything to check?".
// Set at the real count so losing even one assertion is visible, not at 1.
const EXPECTED = 10;
if (checks.length < EXPECTED) {
  console.log(
    `\n✗ only ${checks.length} of ${EXPECTED} assertions were REGISTERED — this run did not ` +
      `check what it claims to. Raise EXPECTED deliberately when adding one; never lower it.`,
  );
  process.exit(2);
}

console.log(
  failed === 0
    ? `\n✓ ${checks.length} assertions — the shape check cannot report success without having run.`
    : `\n✗ ${failed} of ${checks.length} failed`,
);
process.exit(failed === 0 ? 0 : 1);

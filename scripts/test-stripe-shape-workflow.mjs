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
const wf = readFileSync(join(ROOT, ".github/workflows/stripe-shape.yml"), "utf8");

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

let failed = 0;
for (const { name, fn } of checks) {
  const problem = fn();
  if (problem) {
    failed++;
    console.log(`  ✗ ${name}\n      ${problem}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

console.log(
  failed === 0
    ? `\n✓ ${checks.length} assertions — the shape check cannot report success without having run.`
    : `\n✗ ${failed} of ${checks.length} failed`,
);
process.exit(failed === 0 ? 0 : 1);

#!/usr/bin/env node
// F053.11 — the compiler must REFUSE the write that caused the incident.
//
//   node scripts/test-stripe-period-type.mjs
//
// readPeriod's failure branch carries no `end`. That is only a guard if tsc
// actually stops a consumer writing `readPeriod(sub).end` into a nullable
// column — which is exactly what sanneandersen's create branch does today, and
// where "could not read it" became "gift, never expires".
//
// BOTH DIRECTIONS, and the second is the one that makes the first mean
// anything: a test that only checks "tsc failed" passes when tsc fails for a
// typo, a missing import, or a broken tsconfig. So the correct usage must
// COMPILE in the same run.
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "stripe");

const WRONG = `
import { readPeriod } from "./src/fields.js";
import type Stripe from "stripe";
declare const sub: Stripe.Subscription;
// THE INCIDENT, in one line: straight into a column where null means "no expiry".
const currentPeriodEnd: number | null = readPeriod(sub).end;
export { currentPeriodEnd };
`;

const RIGHT = `
import { readPeriod } from "./src/fields.js";
import type Stripe from "stripe";
declare const sub: Stripe.Subscription;
const p = readPeriod(sub);
const currentPeriodEnd: number | null = p.ok ? p.end : null;
const why: string | null = p.ok ? null : p.reason;
export { currentPeriodEnd, why };
`;

const run = (name, src) => {
  const file = join(PKG, name);
  writeFileSync(file, src);
  try {
    execFileSync("npx", ["tsc", "--noEmit", "--strict", "--skipLibCheck", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022", file], {
      cwd: PKG,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { failed: false, out: "" };
  } catch (e) {
    return { failed: true, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  } finally {
    rmSync(file, { force: true });
  }
};

let bad = 0;
const check = (label, ok, detail = "") => {
  console.log(ok ? `  ✓ ${label}` : `  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  if (!ok) bad++;
};

const wrong = run("__f053_11_wrong.ts", WRONG);
check(
  "tsc REFUSES `readPeriod(sub).end` — the write that caused F098.4",
  wrong.failed && /Property 'end' does not exist/.test(wrong.out),
  wrong.failed
    ? `it failed, but not for the right reason:\n      ${wrong.out.split("\n").slice(0, 3).join("\n      ")}`
    : "IT COMPILED. The union has collapsed and the guard is gone — a consumer can store 'unreadable' as null again.",
);

const right = run("__f053_11_right.ts", RIGHT);
check(
  "...and the CORRECT usage still compiles (so the check above is not passing on a broken setup)",
  !right.failed,
  right.out.split("\n").slice(0, 4).join("\n      "),
);

console.log(bad ? `\n${bad} failing\n` : `\nall green\n`);
process.exit(bad ? 1 : 0);

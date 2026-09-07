#!/usr/bin/env node
// F038.16 — the two claims about the workflow that a comment cannot prove.
//
//   node scripts/test-roster-bump-workflow.mjs
//
// Both are the kind of thing that is true when written and quietly stops being
// true: a trigger someone adds for convenience, a step someone moves while
// tidying. Reading the YAML proves it today; this proves it on every push.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const publish = readFileSync(join(ROOT, ".github/workflows/publish.yml"), "utf8");
const discovery = readFileSync(join(ROOT, ".github/workflows/inventory-fresh.yml"), "utf8");

let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
};

// ---------------------------------------------------------------------------
// 1. THE LOOP. The roster job pushes a commit to main. If publish.yml ever gains
//    a branch trigger, that commit re-runs the whole publish workflow, which
//    pushes again — an automation that publishes itself is worse than the manual
//    step it replaced.
// ---------------------------------------------------------------------------
{
  const on = publish.slice(publish.indexOf("\non:"), publish.indexOf("\njobs:"));
  check(
    "publish.yml triggers on TAGS only — a push to main cannot re-enter it",
    /push:\s*\n\s*tags:/.test(on) && !/\n\s{2,}branches:/.test(on),
    "a `branches:` trigger here turns the roster commit into an infinite publish loop",
  );
  check("...and the roster job only runs for a tag", /roster:[\s\S]{0,300}if: startsWith\(github\.ref, 'refs\/tags\/'\)/.test(publish));
}

// ---------------------------------------------------------------------------
// 2. THE DETECTOR STAYS. The automation covers the OIDC path only — a bootstrap
//    publish from a laptop still drifts. And the check is also what would prove
//    the automation had stopped working, so removing it removes the alarm AND
//    the evidence.
// ---------------------------------------------------------------------------
{
  const checkJob = discovery.slice(discovery.indexOf("\n  check:"), discovery.indexOf("\n  changes:"));
  check(
    "check-roster-versions.mjs still runs in the `check` job",
    checkJob.includes("scripts/check-roster-versions.mjs"),
    "the detector is the only thing that catches a laptop publish, and the only proof the automation works",
  );
  check(
    "...and `deploy` still NEEDS check, so a stale roster still blocks the ship",
    /deploy:\s*\n\s*needs: \[check, changes\]/.test(discovery),
    "without the needs: edge the detector is a notification, not a gate (F080's lesson)",
  );
}

// ---------------------------------------------------------------------------
// 3. THE FAILURE DIRECTION. A publish that failed must not bump: the roster
//    would name a version npm does not serve, and a session would be told to
//    install something that does not exist.
// ---------------------------------------------------------------------------
{
  const roster = publish.slice(publish.indexOf("\n  roster:"));
  check(
    "the roster job waits for npm to actually serve the version before bumping",
    /npm view .*steps\.t\.outputs\.pkg.*steps\.t\.outputs\.ver/.test(roster),
    "bumping on job success alone would name a version the registry does not have",
  );
  check(
    "...and skips the bump rather than failing the release when npm stays silent",
    roster.includes('SKIP=1') && /if: env\.SKIP != '1'/.test(roster),
    "an unreachable registry is not a verdict on the release",
  );
  check(
    "the bump uses the script, not inline sed",
    roster.includes("scripts/bump-roster-version.mjs"),
    "inline YAML logic cannot be tested or mutation-proven",
  );
}

console.log(failed ? `\n${failed} failing\n` : `\nall green\n`);
process.exit(failed ? 1 : 0);

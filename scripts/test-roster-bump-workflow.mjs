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

// ---------------------------------------------------------------------------
// 4. THE RACE. Two packages can release at once. Both roster jobs then check out
//    the same main and the second push is rejected as non-fast-forward — losing
//    exactly the bump this card guarantees. The retry must RE-DERIVE from a
//    freshly fetched main, not rebase a commit built on a stale one: the
//    regenerated docs/ conflict line-for-line, and a rebase conflict in CI is a
//    silent no-bump wearing a red X.
// ---------------------------------------------------------------------------
{
  const roster = publish.slice(publish.indexOf("\n  roster:"));
  // The `done` to bound on is the one AFTER the loop opens — the wait step has
  // its own `for … done` earlier in the same job, and slicing to that one
  // yields an EMPTY string, which fails every includes() for the wrong reason.
  const loopAt = roster.indexOf("for attempt in");
  const loop = roster.slice(loopAt, roster.indexOf("\n          done", loopAt));
  check(
    "the push is retried, and each attempt re-fetches main first",
    loop.includes("git fetch") && /git checkout[^\n]*-B main origin\/main/.test(loop) && loop.includes("git push origin main"),
    "without a re-fetch inside the loop, a concurrent release silently loses one bump",
  );
  check(
    "...and a rebase is NOT how it recovers",
    !/git (pull --rebase|rebase)/.test(roster),
    "regenerated docs/ conflict line-for-line; a CI rebase conflict is a no-bump that looks like a failure to fix",
  );
}

// ---------------------------------------------------------------------------
// 5. THREE OUTCOMES, NOT TWO. Bare under `bash -e`, the script's exit 2 — npm
//    unreachable, which is not a verdict on anything — fails the job identically
//    to exit 1, which IS one. That exact collapse was the defect F038.15 fixed
//    one workflow over, four lines below the guard that defined the outcomes.
// ---------------------------------------------------------------------------
{
  const roster = publish.slice(publish.indexOf("\n  roster:"));
  check(
    "exit 2 from the bump script does not fail the job",
    /set \+e[\s\S]{0,400}code=\$\?[\s\S]{0,400}\[ "\$code" = "2" \][\s\S]{0,300}exit 0/.test(roster),
    "an unreachable registry is not a verdict on the release — running it bare under `bash -e` makes it one",
  );
}

console.log(failed ? `\n${failed} failing\n` : `\nall green\n`);
process.exit(failed ? 1 : 0);

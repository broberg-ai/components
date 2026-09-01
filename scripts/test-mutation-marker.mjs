#!/usr/bin/env node
// F081.1 — the tests for the marker, the commit refusal, and the read-back.
//
// Each of the three is proven RED first. A guard nobody has watched fail is not
// a gate, and the whole reason this card exists is that a failed restore looked
// exactly like no restore being needed.
//
//   node scripts/test-mutation-marker.mjs
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MARKER_NAME, MARKER_PATH, REPO_ROOT, readMarker, writeMarker, clearMarker } from "./mutation-marker.mjs";

const HOOK = join(REPO_ROOT, ".githooks/pre-commit");
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.message.split("\n").join("\n      ")}`);
    failures++;
  }
}
const eq = (a, b, what) => {
  if (a !== b) throw new Error(`${what}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);
};
const has = (hay, needle, what) => {
  if (!String(hay).includes(needle)) throw new Error(`${what}\n  missing: ${JSON.stringify(needle)}\n  in: ${String(hay).slice(0, 400)}`);
};

// A REAL harness must not be running, or this test would clobber its marker and
// report a failure that is its own doing.
if (existsSync(MARKER_PATH)) {
  console.error(`::error::${MARKER_NAME} already exists — a harness is running (or a restore failed).`);
  console.error(readMarker().join("\n"));
  process.exit(1);
}

// ── the hook, both directions ────────────────────────────────────────────────
// Run against the real repo so every other layer of the hook is genuinely
// satisfied. The hook only reads; it changes nothing.
function runHook() {
  try {
    const out = execFileSync("bash", [HOOK], { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

console.log("the pre-commit hook, both directions");

// NEGATIVE CONTROL FIRST. Without it the hook could reject everything and the
// positive test below would still pass.
const clean = runHook();
check("with NO marker, the hook does not block on layer 0", () => {
  if (clean.code !== 0) has(clean.out, "", "hook failed for another reason");
  if (String(clean.out).includes(MARKER_NAME)) {
    throw new Error(`the hook mentioned ${MARKER_NAME} with no marker present:\n${clean.out}`);
  }
});

// NAMED AS A FIXTURE, because someone else reads this file. super watched this
// suite from another session and saw entries claiming a harness was mutating
// `packages/x/src/y.ts` — a path that does not exist. A marker whose whole job is
// to explain a confusing tree must not itself be the confusing thing.
const entryBody = (pid, since = new Date().toISOString()) =>
  `harness  scripts/test-mutation-marker.mjs (TEST FIXTURE — no real mutation)\n` +
  `file     (none — this entry is written by the test suite)\n` +
  `pid      ${pid}\nsince    ${since}\n`;
const writeEntry = (pid, since) => {
  mkdirSync(MARKER_PATH, { recursive: true });
  writeFileSync(join(MARKER_PATH, String(pid)), entryBody(pid, since));
};
const hookOver = (pid, since) => {
  writeEntry(pid, since);
  try {
    return runHook();
  } finally {
    rmSync(MARKER_PATH, { recursive: true, force: true });
  }
};

// A pid that is CERTAINLY alive: this very process.
const LIVE_PID = process.pid;
// A pid that is CERTAINLY dead: one we watched exit. Guessing a high number
// would be a pid that is *probably* free, and "probably" is how a flaky test
// becomes a false green.
const DEAD_PID = await new Promise((resolve) => {
  const c = spawn("node", ["-e", "0"], { stdio: "ignore" });
  c.on("exit", () => resolve(c.pid));
});

// `since` a moment ago: this process started BEFORE the entry was written, which
// is what an entry written by its own live harness looks like.
const blocked = hookOver(LIVE_PID, new Date().toISOString());

check("with a marker, the commit is REFUSED", () => eq(blocked.code, 1, "hook exit code"));
check("the block quotes the marker, so the reader learns WHICH harness", () => {
  has(blocked.out, "TEST FIXTURE", "harness name not surfaced");
  has(blocked.out, "written by the test suite", "file line not surfaced");
  has(blocked.out, String(LIVE_PID), "pid not surfaced");
});
check("a LIVE pid reads as still running, and says to wait", () => {
  has(blocked.out, "STILL RUNNING", "did not say the harness is alive");
  has(blocked.out, "Wait for it to finish", "did not tell the reader to wait");
});

// THE OTHER DIRECTION, and it is the one that matters at 3am: a harness that was
// killed leaves an entry nobody will clear. The block must say so rather than
// telling the reader to wait for a process that no longer exists.
const stale = hookOver(DEAD_PID, new Date().toISOString());

check("a DEAD pid reads as STALE, not as a run in progress", () => {
  eq(stale.code, 1, "hook exit code");
  has(stale.out, "STALE", "a dead pid was not reported as stale");
  if (String(stale.out).includes("STILL RUNNING")) {
    throw new Error("a dead pid was reported as still running — the reader would wait forever");
  }
});
check("...and it says to CHECK THE FILES before clearing, not just to delete", () => {
  // The stale case means a restore may never have happened, so the mutation can
  // still be on disk. Telling someone to `rm` the marker and stop there would
  // remove the only sign that anything is wrong.
  has(stale.out, "may still hold", "did not warn that the file may still be mutated");
  has(stale.out, "git status", "no way to check what was left behind");
});

// A REUSED PID — super's second finding. A harness that died without clearing
// its entry leaves a pid the OS is free to hand to something else, and macOS
// reuses pids overnight. `ps -p` then says "still running" about a stranger, the
// STALE branch is never reached, and the hook blocks forever on a process that
// was never ours.
//
// This process EXISTS and started long after a marker dated an hour ago — which
// is exactly the shape of a stranger holding a recycled pid.
const reused = hookOver(LIVE_PID, new Date(Date.now() - 3600_000).toISOString());
check("a pid REUSED by another process reads as stale, not as still running", () => {
  eq(reused.code, 1, "hook exit code");
  has(reused.out, "REUSED", "a recycled pid was not detected");
  if (String(reused.out).includes("is STILL RUNNING")) {
    throw new Error("a stranger holding the pid was reported as our harness — the hook would block forever");
  }
});

// F081.3 — THE PLATFORM ITSELF, not another pid case. Every branch above needs
// two timestamps turned into epoch seconds, and `date` has two incompatible
// dialects: GNU wants `-d`, BSD wants `-j -f`. With only the BSD form the hook
// worked on this Mac and, on the Ubuntu runner CI uses, returned nothing for
// every conversion — so every live pid, recycled or not, fell into "could NOT
// check". Safe direction, wrong every single time, and the four states this
// block exists to tell apart were one state wide where it mattered.
//
// The two checks above already went red on that (run 33489536202). This one
// names the CAUSE instead of the symptom, so a platform with no working dialect
// says so rather than looking like two unrelated pid bugs.
check("a readable pid never lands in `could NOT check` on this platform", () => {
  for (const [name, r] of [["live", blocked], ["reused", reused]]) {
    if (String(r.out).includes("could NOT check")) {
      throw new Error(
        `the ${name} pid fell into the could-not-check branch: this platform's \`date\` ` +
          "parses neither the GNU nor the BSD dialect, so all four pid states collapse into one",
      );
    }
  }
});

// AND THE THIRD OUTCOME. When the comparison cannot be made at all, that is not
// "fine": it keeps the block up AND says the check did not happen, rather than
// silently taking the reassuring branch. The whole family of defects found
// today is a check that cannot tell "nothing is wrong" from "I did not look".
const unreadable = hookOver(LIVE_PID, "not-a-date");
check("an unreadable `since` says the check could NOT be made, and still blocks", () => {
  eq(unreadable.code, 1, "hook exit code");
  has(unreadable.out, "could NOT check", "silently picked a branch it could not justify");
});

// SUPER'S FIRST FINDING, 2026-09-01, and it changed this message. The block used to
// say "if nothing is running (ps aux | grep mutations.mjs)". That pattern is a
// SUBSTRING and matches scripts/test-precommit-secret-gate-mutations.mjs, which
// never holds the marker — a true count answering a different question. A reader
// following it would wait for a process that was never the one holding it.
check("the block never sends the reader to a substring grep", () => {
  for (const out of [blocked.out, stale.out, reused.out, unreadable.out]) {
    if (String(out).includes("grep mutations.mjs")) {
      throw new Error("still recommending `grep mutations.mjs`, which matches unrelated scripts");
    }
  }
});
check("the block carries the way OUT (--no-verify is forbidden by the contract)", () =>
  has(stale.out, `rm -r `, "no clearing command in the message"));

check("and the marker is gone again afterwards", () => eq(existsSync(MARKER_PATH), false, "marker left behind"));

// ── the read-back ────────────────────────────────────────────────────────────
console.log("\nthe read-back after a restore");

function callAssertRestored({ onDisk, expected }) {
  const tmp = join(REPO_ROOT, "node_modules", ".f081-probe.txt");
  writeFileSync(tmp, onDisk);
  const src = `
    import { assertRestored } from ${JSON.stringify(join(REPO_ROOT, "scripts/mutation-marker.mjs"))};
    assertRestored({ harness: "probe-harness", file: ${JSON.stringify(tmp)}, expected: ${JSON.stringify(expected)} });
    console.log("RETURNED NORMALLY");
  `;
  try {
    const out = execFileSync("node", ["--input-type=module", "-e", src], {
      cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe",
    });
    return { code: 0, stdout: out, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  } finally {
    rmSync(tmp, { force: true });
  }
}

const restored = callAssertRestored({ onDisk: "the original", expected: "the original" });
check("a restore that WORKED returns quietly", () => {
  eq(restored.code, 0, "exit code");
  has(restored.stdout, "RETURNED NORMALLY", "did not return");
});

const failed = callAssertRestored({ onDisk: "if (false) {", expected: "if (opts?.valueOnly) {" });
try {
  check("a restore that FAILED exits non-zero", () => eq(failed.code, 1, "exit code"));
  check("...and says so on STDOUT, where buddy's alarm did not", () => {
    has(failed.stdout, "RESTORE FAILED", "no alarm on stdout");
    has(failed.stdout, "probe-harness", "harness not named");
    if (String(failed.stdout).includes("RETURNED NORMALLY")) throw new Error("it returned instead of exiting");
  });
  check("...and leaves the marker UP, because the tree is genuinely broken", () => {
    eq(existsSync(MARKER_PATH), true, "marker missing after a failed restore");
    has(readMarker().join("\n"), "THE RESTORE FAILED", "marker does not say the restore failed");
  });
  check("...and the marker distinguishes a failed restore from a run in progress", () => {
    const m = readMarker().join("\n");
    has(m, "no harness is coming back to fix it", "reads like an ordinary run in progress");
  });
} finally {
  rmSync(MARKER_PATH, { recursive: true, force: true });
}

// ── the marker during a REAL run ─────────────────────────────────────────────
// Asserted by reading the file a live harness wrote, never by reading the code
// that writes it.
console.log("\nthe marker during a REAL harness run");

// F081_FAST swaps the real ~35s stripe harness for a minimal fixture that
// touches the marker identically. Set ONLY by the mutation pass, which runs this
// whole file seven times. The fixture stands in for a caller of our own module,
// never for an external party — and the default path here is the real harness.
const FAST = process.env.F081_FAST === "1";
const HARNESS_PKG = FAST ? REPO_ROOT : join(REPO_ROOT, "packages/stripe");
const HARNESS_ARGV = FAST ? ["scripts/__fixtures__/f081-fixture-harness.mjs"] : ["test/mutations.mjs"];
console.log(FAST ? "  (F081_FAST: minimal fixture harness)" : "  (the real @broberg/stripe harness)");
const seen = { existed: false, body: "", pid: null };
await new Promise((resolve) => {
  const child = spawn("node", HARNESS_ARGV, { cwd: HARNESS_PKG, stdio: "ignore" });
  seen.pid = child.pid;
  const poll = setInterval(() => {
    if (!seen.existed && existsSync(MARKER_PATH)) {
      seen.existed = true;
      try { seen.body = readMarker().join("\n"); } catch { /* raced the rewrite */ }
    }
  }, 50);
  child.on("exit", (code) => { clearInterval(poll); seen.exit = code; resolve(); });
});

check("the marker EXISTED while the harness ran", () => eq(seen.existed, true, "never observed"));
check("it named the harness, the file and the REAL pid", () => {
  has(seen.body, "@broberg/stripe", "harness not named");
  has(seen.body, "packages/stripe/src/fields.ts", "mutated file not named");
  // The pid the process ACTUALLY has, not the word "pid". Measured while
  // writing this: asserting the label passed happily on `pid  (withheld)`, so
  // the mutation that removes the pid survived. An assertion weak enough to
  // pass on the mutated value fails in the GREEN direction, which is worse than
  // having none.
  has(seen.body, String(seen.pid), `pid ${seen.pid} not in the marker`);
});
check("it warned the reader that the diff may show a defect that is not there", () =>
  has(seen.body, "BROKEN code", "no warning for the reader who falls over it"));
check("the harness itself still passed", () => eq(seen.exit, 0, "harness exit code"));
check("and the marker is GONE now the run is over", () => eq(existsSync(MARKER_PATH), false, "marker left behind"));

// ── two harnesses at once ───────────────────────────────────────────────────
// `turbo run test` runs packages in PARALLEL, so this is the ORDINARY path, not
// an edge case. Measured while building this: with one shared marker FILE, the
// first harness to finish removed it for every harness still mutating, and the
// window reopened in silence — the exact failure the marker exists to close,
// reintroduced by the marker.
console.log("\ntwo harnesses at once (the ordinary `turbo run test` path)");

const conc = await new Promise((resolve) => {
  const out = { markerAfterShortExited: null, markerAfterBothExited: null, exits: [] };
  const long = spawn("node", ["scripts/__fixtures__/f081-fixture-harness.mjs", "2500", "-long"], {
    cwd: REPO_ROOT, stdio: "ignore",
  });
  // Staggered so the short one is guaranteed to start, finish and clean up well
  // inside the long one's window.
  setTimeout(() => {
    const short = spawn("node", ["scripts/__fixtures__/f081-fixture-harness.mjs", "150", "-short"], {
      cwd: REPO_ROOT, stdio: "ignore",
    });
    short.on("exit", (c) => {
      out.exits.push(["short", c]);
      // THE ASSERTION THAT MATTERS: the short one is gone, the long one is not.
      out.markerAfterShortExited = existsSync(MARKER_PATH) ? readMarker().join("\n") : null;
    });
  }, 400);
  long.on("exit", (c) => {
    out.exits.push(["long", c]);
    out.markerAfterBothExited = existsSync(MARKER_PATH);
    resolve(out);
  });
});

check("both fixture harnesses exited cleanly", () => {
  for (const [which, code] of conc.exits) eq(code, 0, `${which} harness exit code`);
});
check("the first to FINISH does not un-announce the one still running", () => {
  if (conc.markerAfterShortExited === null) {
    throw new Error("the marker was gone the moment the short harness exited, while the long one was still mutating");
  }
  has(conc.markerAfterShortExited, "fixture-long", "the long harness's entry did not survive");
});
check("...and its OWN entry is gone (it does not leak)", () =>
  eq(conc.markerAfterShortExited.includes("fixture-short"), false, "the short harness left its entry behind"));
check("the marker is gone once the LAST one finishes", () =>
  eq(conc.markerAfterBothExited, false, "marker outlived every harness"));

// ── all four real harnesses, not just the one we spawned ────────────────────
// The run above proves ONE harness writes the marker. This proves the other
// three call the same three functions. It is a STATIC check and says so: it
// reads the source, so it cannot tell a call from a call that never executes.
// The spawned run is what proves execution; this is what proves coverage.
console.log("\nevery harness in the repo is wired to it");
// DISCOVERED, not listed. A hand-maintained list is a list someone forgets to
// add to — and the F081 epic's whole claim is that a NEW harness inherits the
// invariants or it is not finished. `git ls-files` finds every harness in the
// repo, so a fifth one cannot escape by not being written down here.
const harnesses = execFileSync("git", ["ls-files", "*mutations.mjs"], { cwd: REPO_ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  // scripts/test-*-mutations.mjs are meta-harnesses that mutate the gate itself
  // and deliberately do not import the module they are mutating.
  .filter((p) => !p.startsWith("scripts/test-"));
check("every harness in the repo was FOUND (a zero-length list would pass every check below)", () => {
  if (harnesses.length < 4) throw new Error(`only found ${harnesses.length}: ${harnesses.join(", ")}`);
});
for (const rel of harnesses) {
  const pkg = rel;
  const f = join(REPO_ROOT, rel);
  check(`${pkg} calls writeMarker, clearMarker and assertRestored`, () => {
    const src = readFileSync(f, "utf8");
    has(src, "mutation-marker.mjs", "does not import the shared module");
    for (const fn of ["writeMarker(", "clearMarker(", "assertRestored("]) {
      has(src, fn, `never calls ${fn})`);
    }
  });
}

console.log("");
if (failures) {
  console.error(`::error::${failures} check(s) failed.`);
  process.exit(1);
}
console.log("✓ marker, commit refusal and read-back all proven in both directions.");

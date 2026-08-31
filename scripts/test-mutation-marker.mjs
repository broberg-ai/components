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

mkdirSync(MARKER_PATH, { recursive: true });
writeFileSync(join(MARKER_PATH, "4242"), "harness  test-harness\nfile     packages/x/src/y.ts\npid      4242\n");
let blocked;
try {
  blocked = runHook();
} finally {
  rmSync(MARKER_PATH, { recursive: true, force: true });
}

check("with a marker, the commit is REFUSED", () => eq(blocked.code, 1, "hook exit code"));
check("the block quotes the marker, so the reader learns WHICH harness", () => {
  has(blocked.out, "test-harness", "harness name not surfaced");
  has(blocked.out, "packages/x/src/y.ts", "mutated file not surfaced");
  has(blocked.out, "4242", "pid not surfaced");
});
check("the block carries the way OUT (--no-verify is forbidden by the contract)", () =>
  has(blocked.out, `rm `, "no clearing command in the message"));

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
for (const pkg of ["secret-scan", "mail", "greppable", "stripe"]) {
  const f = join(REPO_ROOT, "packages", pkg, "test/mutations.mjs");
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

#!/usr/bin/env node
// F081.5 — both directions on the scope selector, in real git repos.
//
// The dangerous direction is a SKIP that should have been a run, so every check
// below that expects a run is the one that matters. The skip checks exist so the
// saving is real rather than assumed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/mutations-if-changed.mjs");
let failures = 0;

function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}
const has = (out, txt, why) => {
  if (!String(out).includes(txt)) throw new Error(`${why}\n        missing: ${JSON.stringify(txt)}\n        in: ${String(out).slice(0, 400)}`);
};

/** The fixture's environment must be OURS, not the job's.
 *  Measured 2026-09-03: on the `mail-core-v0.2.0` tag push the job's own
 *  GITHUB_REF was inherited by every fixture, so the selector answered
 *  "RELEASE — every harness runs" in all of them. Five checks went red and
 *  blocked a legitimate publish — but the expensive half is the other one:
 *  the tag check PASSED for the ambient reason, not the reason it tests.
 *  These three are the only inputs the selector reads; all three are ours. */
function fixtureEnv(extra = {}) {
  return {
    ...process.env,
    GITHUB_REF: undefined, GITHUB_REF_TYPE: undefined, GITHUB_EVENT_BEFORE: undefined,
    ...extra,
  };
}

/** A throwaway repo: alpha (independent), beta (depends on alpha), gamma
 *  (independent, and the only honest "unrelated" package — beta is NOT
 *  unrelated, which this test got wrong on its first run). */
function repo({ branch = "main" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scope-"));
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
  g("init", "-q", "-b", branch);
  g("config", "user.email", "t@t.dk"); g("config", "user.name", "t");
  for (const [name, deps] of [["alpha", {}], ["beta", { "@broberg/alpha": "1.0.0" }], ["gamma", {}]]) {
    mkdirSync(join(dir, "packages", name, "test"), { recursive: true });
    writeFileSync(join(dir, "packages", name, "package.json"),
      JSON.stringify({ name: `@broberg/${name}`, dependencies: deps }, null, 2));
    // The "harness": prints a word the test can look for.
    writeFileSync(join(dir, "packages", name, "test", "mutations.mjs"),
      `console.log("HARNESS RAN: ${name}");\n`);
    writeFileSync(join(dir, "packages", name, "src.txt"), "v1\n");
  }
  writeFileSync(join(dir, "root.txt"), "v1\n");
  g("add", "-A"); g("commit", "-qm", "base");
  return { dir, g, baseSha: g("rev-parse", "HEAD").trim() };
}

/** Run the selector from inside a package, with the base pinned explicitly. */
function scope(dir, pkg, base) {
  return execFileSync("node", [SCRIPT, "test/mutations.mjs"], {
    cwd: join(dir, "packages", pkg), encoding: "utf8",
    env: fixtureEnv({ GITHUB_EVENT_BEFORE: base }),
  });
}

console.log("scope selector — both directions\n");

// ── the package itself changed ────────────────────────────────────────────
{
  const { dir, g, baseSha } = repo();
  writeFileSync(join(dir, "packages/alpha/src.txt"), "v2\n");
  g("add", "-A"); g("commit", "-qm", "touch alpha");
  const out = scope(dir, "alpha", baseSha);
  check("a CHANGED package runs its harness", () =>
    has(out, "HARNESS RAN: alpha", "the harness did not run"));
  const other = scope(dir, "gamma", baseSha);
  check("...and a genuinely UNRELATED package is SKIPPED, saying so", () => {
    has(other, "SKIPPED", "no skip line");
    has(other, "NOT a pass", "the skip did not say it is not a pass");
    if (other.includes("HARNESS RAN")) throw new Error("it ran anyway");
  });
  rmSync(dir, { recursive: true, force: true });
}

// ── CHRISTIAN'S CONSTRAINT: a dependency changed ──────────────────────────
// "the package did not change" is not "nothing that affects it changed".
{
  const { dir, g, baseSha } = repo();
  writeFileSync(join(dir, "packages/alpha/src.txt"), "v2\n");
  g("add", "-A"); g("commit", "-qm", "touch alpha only");
  const out = scope(dir, "beta", baseSha);
  check("a package whose DEPENDENCY changed still runs", () =>
    has(out, "HARNESS RAN: beta", "beta was skipped even though @broberg/alpha changed — this is the dangerous direction"));
  rmSync(dir, { recursive: true, force: true });
}

// ── anything outside packages/ ────────────────────────────────────────────
{
  const { dir, g, baseSha } = repo();
  writeFileSync(join(dir, "root.txt"), "v2\n");
  g("add", "-A"); g("commit", "-qm", "touch root");
  const out = scope(dir, "beta", baseSha);
  check("a change OUTSIDE packages/ runs everything", () =>
    has(out, "HARNESS RAN: beta", "a root-level change did not force a run"));
  check("...and says which file made it decide", () =>
    has(out, "root.txt", "the reason was not named"));
  rmSync(dir, { recursive: true, force: true });
}

// ── the working tree must NOT decide ──────────────────────────────────────
// Measured while writing this: turbo's own [HEAD^1] filter reported a package as
// changed because a mutation harness had it mutated ON DISK. A selector that
// reads the working tree picks a different set every run.
{
  const { dir, g, baseSha } = repo();
  writeFileSync(join(dir, "root.txt"), "v2\n");
  g("add", "-A"); g("commit", "-qm", "touch root elsewhere");
  const { dir: d2, g: g2, baseSha: b2 } = repo();
  writeFileSync(join(d2, "packages/alpha/src.txt"), "MUTATED, uncommitted\n");
  const out = scope(d2, "alpha", b2);
  check("an UNCOMMITTED mutation does not make a package look changed", () => {
    has(out, "SKIPPED", "a dirty working tree changed the decision — a running harness would reselect the set");
    if (out.includes("HARNESS RAN")) throw new Error("the working tree decided");
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(d2, { recursive: true, force: true });
}

// ── no base at all ────────────────────────────────────────────────────────
{
  // Neither `origin/main` nor `main` exists here, so no base can be resolved.
  // The first version of this test used a repo whose own branch WAS main, so a
  // base resolved fine and the case never ran.
  const { dir } = repo({ branch: "work" });
  const out = execFileSync("node", [SCRIPT, "test/mutations.mjs"], {
    cwd: join(dir, "packages", "alpha"), encoding: "utf8",
    env: fixtureEnv({ GITHUB_EVENT_BEFORE: "" }),
  });
  check("an UNRESOLVABLE base runs the harness rather than skipping", () =>
    has(out, "HARNESS RAN: alpha", "it skipped when it could not tell — the reassuring branch"));
  check("...and says the scope was unknown", () =>
    has(out, "UNKNOWN", "it did not disclose that it could not determine the scope"));
  rmSync(dir, { recursive: true, force: true });
}

// ── A RELEASE RUNS EVERYTHING (AC#4) ─────────────────────────────────────
// publish.yml's gate reuses test.yml, so a tag push runs this selector — and on
// a tag the natural base is HEAD itself (the tagged commit is already on main),
// which would skip EVERY harness on the one run that guards a publish.
{
  const { dir, g, baseSha } = repo();
  writeFileSync(join(dir, "root-unrelated.txt"), "v1\n");
  g("add", "-A"); g("commit", "-qm", "unrelated");
  const asTag = (extra) => execFileSync("node", [SCRIPT, "test/mutations.mjs"], {
    cwd: join(dir, "packages", "gamma"), encoding: "utf8",
    env: fixtureEnv({ GITHUB_EVENT_BEFORE: g("rev-parse", "HEAD").trim(), ...extra }),
  });
  // Control first: with the base AT HEAD and no tag, gamma skips.
  check("CONTROL: base at HEAD and no tag ⇒ gamma skips", () => {
    const out = asTag({});
    has(out, "SKIPPED", "the control did not skip, so the tag case below proves nothing");
  });
  check("a TAG push runs the harness even with an empty diff", () => {
    const out = asTag({ GITHUB_REF: "refs/tags/theme-v1.2.3", GITHUB_REF_TYPE: "tag" });
    has(out, "HARNESS RAN: gamma", "a release would have published on a gate that ran no harness");
  });
  check("...and says it is a release, naming the ref", () => {
    const out = asTag({ GITHUB_REF: "refs/tags/theme-v1.2.3", GITHUB_REF_TYPE: "tag" });
    has(out, "RELEASE", "the reason was not disclosed");
    has(out, "refs/tags/theme-v1.2.3", "the ref was not named");
  });
  rmSync(dir, { recursive: true, force: true });
}

// ── THE LEAK ITSELF (2026-09-03) ─────────────────────────────────────────
// The suite above is only meaningful if the fixtures decide their own scope.
// This reproduces the exact CI condition that broke it: run the whole job as a
// TAG push, and require an unrelated package to STILL skip. Without the
// isolation this check goes red — which is what makes it a check.
{
  const saved = { REF: process.env.GITHUB_REF, TYPE: process.env.GITHUB_REF_TYPE };
  process.env.GITHUB_REF = "refs/tags/mail-core-v0.2.0";
  process.env.GITHUB_REF_TYPE = "tag";
  try {
    const { dir, g, baseSha } = repo();
    writeFileSync(join(dir, "packages/alpha/src.txt"), "v2\n");
    g("add", "-A"); g("commit", "-qm", "touch alpha");
    const out = scope(dir, "gamma", baseSha);
    check("the JOB being a tag push does not decide the FIXTURE's scope", () => {
      has(out, "SKIPPED", "the job's own GITHUB_REF leaked into the fixture — every case below it then passes as a release, including the tag case, which would prove nothing");
      if (out.includes("HARNESS RAN")) throw new Error("the ambient environment decided");
    });
    rmSync(dir, { recursive: true, force: true });
  } finally {
    if (saved.REF === undefined) delete process.env.GITHUB_REF; else process.env.GITHUB_REF = saved.REF;
    if (saved.TYPE === undefined) delete process.env.GITHUB_REF_TYPE; else process.env.GITHUB_REF_TYPE = saved.TYPE;
  }
}

console.log("");
if (failures) { console.error(`::error::${failures} check(s) failed.`); process.exit(1); }
console.log("✓ scope selector proven in both directions.");

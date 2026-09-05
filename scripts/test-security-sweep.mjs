#!/usr/bin/env node
// F082.1 — the ledger planner's tests.
//
//   node scripts/test-security-sweep.mjs
//
// Every case runs against a FAKE git, so the assertions are about the planner's
// rules and not about this repo's history — which changes under it every commit.
// The one case that must touch a real repo (the CLI's exit code) builds its own
// throwaway one.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The module under test is INDIRECTED so the mutation harness can point this
// same suite at a mutated COPY. Without it a harness must overwrite the real
// script, and an interrupted run leaves a mutant on disk.
const SWEEP = process.env.SWEEP_UNDER_TEST ?? new URL("./security-sweep.mjs", import.meta.url).pathname;
const { buildPlan, isSource, depsChanged, listPackages } = await import(SWEEP);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); failures++; }
};
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${what}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);
  }
};

/**
 * A fake git.
 *   pkgs     — package names that exist
 *   changed  — { [sinceSha]: string[] } paths changed between that sha and HEAD
 *   blobs    — { "<sha>:<path>": text } for show()
 *   src      — { [pkg]: string[] } files ls-files reports under src/
 *   ancestors— shas that ARE ancestors of HEAD (anything else is not)
 *   numstat  — { [path]: lines } line counts for diffLines
 */
function fakeGit({ pkgs = [], changed = {}, blobs = {}, src = {}, ancestors = null, numstat = {} } = {}) {
  return {
    head: () => "HEAD",
    isAncestor: (sha) => (ancestors === null ? true : ancestors.includes(sha)),
    diffNames: (from) => changed[from] ?? [],
    diffLines: (_from, paths) => paths.reduce((n, p) => n + (numstat[p] ?? 0), 0),
    show: (sha, path) => blobs[`${sha}:${path}`] ?? null,
    lineCountsAtHead: () => new Map(
      Object.entries(blobs)
        .filter(([k]) => k.startsWith("HEAD:"))
        .map(([k, v]) => [k.slice(5), v.split("\n").filter(Boolean).length]),
    ),
    lsFiles: (glob) => {
      if (glob === "packages/*/package.json") return pkgs.map((p) => `packages/${p}/package.json`);
      const m = glob.match(/^packages\/([^/]+)\/src\/\*$/);
      return m ? (src[m[1]] ?? []) : [];
    },
  };
}

const pj = (deps = {}, version = "1.0.0") => JSON.stringify({ name: "x", version, dependencies: deps });

console.log("security-sweep · the ledger planner");

// ── AC#1 — an empty ledger is a full backlog, with real line counts ──────────

check("AC#1 an EMPTY ledger lists every package as never-reviewed", () => {
  const git = fakeGit({
    pkgs: ["auth", "sms", "mail"],
    src: {
      auth: ["packages/auth/src/index.ts"],
      sms: ["packages/sms/src/index.ts"],
      mail: ["packages/mail/src/index.ts"],
    },
    blobs: {
      "HEAD:packages/auth/src/index.ts": "a\nb\nc\n",
      "HEAD:packages/sms/src/index.ts": "a\n",
      "HEAD:packages/mail/src/index.ts": "a\nb\n",
    },
  });
  const { plan, errors } = buildPlan({}, git);
  eq(errors, [], "no errors on an empty ledger");
  eq(plan.map((p) => p.name), ["@broberg/auth", "@broberg/mail", "@broberg/sms"], "all packages listed, in roster order");
  eq(plan.every((p) => p.reason === "never reviewed"), true, "every reason is never-reviewed");
});

check("AC#1 a never-reviewed package reports its WHOLE-SOURCE line count, not zero", () => {
  const git = fakeGit({
    pkgs: ["auth"],
    src: { auth: ["packages/auth/src/a.ts", "packages/auth/src/b.ts"] },
    blobs: {
      "HEAD:packages/auth/src/a.ts": "1\n2\n3\n4\n5\n",
      "HEAD:packages/auth/src/b.ts": "1\n2\n",
    },
  });
  const { plan } = buildPlan({}, git);
  eq(plan[0].lines, 7, "5 + 2 source lines");
  eq(plan[0].files.length, 2, "both files listed");
  eq(plan[0].wholeSource, true, "flagged as a whole-source read");
});

check("AC#1 a never-reviewed package's line count EXCLUDES its tests", () => {
  const git = fakeGit({
    pkgs: ["auth"],
    src: { auth: ["packages/auth/src/a.ts", "packages/auth/src/a.test.ts"] },
    blobs: {
      "HEAD:packages/auth/src/a.ts": "1\n2\n",
      "HEAD:packages/auth/src/a.test.ts": "1\n2\n3\n4\n5\n6\n7\n8\n9\n",
    },
  });
  const { plan } = buildPlan({}, git);
  eq(plan[0].lines, 2, "only the shipped file counts");
});

// ── AC#2 — a pinned entry bounds the read; a current one removes it ──────────

check("AC#2 a package pinned at an OLDER commit lists only ITS changed files", () => {
  const git = fakeGit({
    pkgs: ["auth", "sms"],
    ancestors: ["old"],
    changed: { old: ["packages/auth/src/session.ts", "packages/sms/src/send.ts", "docs/x.md"] },
    numstat: { "packages/auth/src/session.ts": 12 },
    blobs: {},
  });
  const { plan } = buildPlan({
    "@broberg/auth": { reviewed_at_commit: "old" },
    "@broberg/sms": { reviewed_at_commit: "head" },
  }, git);
  eq(plan.length, 1, "only auth is in the plan");
  eq(plan[0].files, ["packages/auth/src/session.ts"], "sms's file is NOT attributed to auth");
  eq(plan[0].lines, 12, "line volume comes from the diff, not the whole file");
});

check("AC#2 a package pinned at a commit with NOTHING since is absent from the plan", () => {
  const git = fakeGit({ pkgs: ["auth"], ancestors: ["cur"], changed: { cur: [] } });
  const { plan, errors } = buildPlan({ "@broberg/auth": { reviewed_at_commit: "cur" } }, git);
  eq(errors, [], "no errors");
  eq(plan, [], "an up-to-date package produces no work");
});

// ── AC#3 — three separate cases, each asserted ──────────────────────────────

check("AC#3a a README-only change does NOT put a package in the plan", () => {
  const git = fakeGit({
    pkgs: ["auth"], ancestors: ["old"],
    changed: { old: ["packages/auth/README.md"] },
  });
  eq(buildPlan({ "@broberg/auth": { reviewed_at_commit: "old" } }, git).plan, [], "README is not a security surface");
});

check("AC#3b a VERSION-only package.json change does NOT put a package in the plan", () => {
  const git = fakeGit({
    pkgs: ["auth"], ancestors: ["old"],
    changed: { old: ["packages/auth/package.json"] },
    blobs: {
      "old:packages/auth/package.json": pj({ zod: "^3.0.0" }, "0.4.1"),
      "HEAD:packages/auth/package.json": pj({ zod: "^3.0.0" }, "0.5.0"),
    },
  });
  eq(buildPlan({ "@broberg/auth": { reviewed_at_commit: "old" } }, git).plan, [],
    "the manifest moved but its dependency surface did not");
});

check("AC#3c a TEST-only change does NOT put a package in the plan", () => {
  const git = fakeGit({
    pkgs: ["auth"], ancestors: ["old"],
    // All four layouts we actually use. The last two are the ones that make the
    // `/test/` and `__tests__` clauses load-bearing: a sibling test/ directory
    // OUTSIDE src/ is already excluded by the path prefix, so a fixture with
    // only those would leave those clauses unmeasured — and the mutation harness
    // said exactly that before these two lines existed.
    changed: { old: [
      "packages/auth/test/session.test.ts",   // sibling test dir
      "packages/auth/src/x.test.ts",          // co-located *.test.ts
      "packages/auth/src/test/fixtures.ts",   // a test dir INSIDE src
      "packages/auth/src/__tests__/helper.ts",
    ] },
  });
  eq(buildPlan({ "@broberg/auth": { reviewed_at_commit: "old" } }, git).plan, [], "tests cannot ship");
});

check("AC#3d ONE line of src/** DOES put a package in the plan", () => {
  const git = fakeGit({
    pkgs: ["auth"], ancestors: ["old"],
    changed: { old: ["packages/auth/src/session.ts"] },
    numstat: { "packages/auth/src/session.ts": 1 },
  });
  const { plan } = buildPlan({ "@broberg/auth": { reviewed_at_commit: "old" } }, git);
  eq(plan.length, 1, "in the plan");
  eq(plan[0].reason, "source", "reason names the source change");
});

check("AC#3e a DEPENDENCIES change DOES put a package in the plan, with our source untouched", () => {
  const git = fakeGit({
    pkgs: ["auth"], ancestors: ["old"],
    changed: { old: ["packages/auth/package.json"] },
    numstat: { "packages/auth/package.json": 2 },
    blobs: {
      "old:packages/auth/package.json": pj({ zod: "^3.0.0" }),
      "HEAD:packages/auth/package.json": pj({ zod: "^3.0.0", "left-pad": "^1.0.0" }),
    },
  });
  const { plan } = buildPlan({ "@broberg/auth": { reviewed_at_commit: "old" } }, git);
  eq(plan.length, 1, "a supply-chain change is a security change");
  eq(plan[0].reason, "dependencies", "reason names the dependency change");
  eq(plan[0].files, ["packages/auth/package.json"], "the manifest is what gets read");
});

check("AC#3f source AND dependencies together are reported as both", () => {
  const git = fakeGit({
    pkgs: ["auth"], ancestors: ["old"],
    changed: { old: ["packages/auth/src/a.ts", "packages/auth/package.json"] },
    blobs: {
      "old:packages/auth/package.json": pj({ zod: "^3.0.0" }),
      "HEAD:packages/auth/package.json": pj({ zod: "^4.0.0" }),
    },
  });
  const { plan } = buildPlan({ "@broberg/auth": { reviewed_at_commit: "old" } }, git);
  eq(plan[0].reason, "source + dependencies", "neither half hides the other");
});

check("a RANGE bump on an existing dependency counts — not just a new name", () => {
  eq(depsChanged(pj({ zod: "^3.0.0" }), pj({ zod: "^3.25.0" })), true, "^3.0.0 → ^3.25.0 is a different tree");
});

check("an UNPARSEABLE manifest is reviewed, never assumed unchanged", () => {
  eq(depsChanged("{ not json", "{ not json"), true,
    "two unreadable files must not compare equal — that would report 'unchanged' about a file neither side read");
});

// ── AC#4 — a fabricated ledger entry fails loudly ───────────────────────────

check("AC#4 a reviewed_at_commit that is NOT an ancestor of HEAD is an error naming the package", () => {
  const git = fakeGit({ pkgs: ["auth", "sms"], ancestors: ["real"], changed: { real: [] } });
  const { plan, errors } = buildPlan({
    "@broberg/auth": { reviewed_at_commit: "deadbeef" },
    "@broberg/sms": { reviewed_at_commit: "real" },
  }, git);
  eq(errors.length, 1, "one error");
  eq(/@broberg\/auth/.test(errors[0]), true, "the package is NAMED");
  eq(/deadbeef/.test(errors[0]), true, "the offending sha is quoted");
  eq(plan.length, 0, "the bad package is not silently planned as if it were fine");
});

check("AC#4 EVERY bad entry is named in one run, not just the first", () => {
  const git = fakeGit({ pkgs: ["auth", "sms", "mail"], ancestors: [], changed: {} });
  const { errors } = buildPlan({
    "@broberg/auth": { reviewed_at_commit: "aaa" },
    "@broberg/sms": { reviewed_at_commit: "bbb" },
    "@broberg/mail": { reviewed_at_commit: "ccc" },
  }, git);
  eq(errors.length, 3, "all three named in one pass");
});

check("an entry with a TIMESTAMP but no commit counts as never reviewed, not as reviewed", () => {
  const git = fakeGit({ pkgs: ["auth"], src: { auth: [] } });
  const { plan } = buildPlan({ "@broberg/auth": { reviewed_at: "2026-09-03T00:00:00Z", findings: 0 } }, git);
  eq(plan.length, 1, "a date alone is not a review");
  eq(plan[0].reason, "never reviewed", "and it is reported as never reviewed");
});

// ── AC#6 — the answer comes from git, and only from git ─────────────────────

check("AC#6 the planner asks git for changed names — never the filesystem", () => {
  let askedDiff = false;
  const git = fakeGit({ pkgs: ["auth"], ancestors: ["old"], changed: { old: [] } });
  const spied = { ...git, diffNames: (f) => { askedDiff = true; return git.diffNames(f); } };
  buildPlan({ "@broberg/auth": { reviewed_at_commit: "old" } }, spied);
  eq(askedDiff, true, "diffNames was the source of the answer");
});

check("AC#6 the package roster comes from git ls-files, not a directory walk", () => {
  const git = fakeGit({ pkgs: ["auth", "sms"] });
  eq(listPackages(git), ["auth", "sms"], "roster read from the index");
});

check("isSource keeps src/testing.ts — a shipped module whose NAME contains 'test'", () => {
  eq(isSource("packages/chat/src/testing.ts", "chat"), true, "testing.ts is source, not a test");
  eq(isSource("packages/chat/src/a.test.ts", "chat"), false, "a.test.ts is a test");
  eq(isSource("packages/chat/test/a.ts", "chat"), false, "test/ is tests");
  eq(isSource("packages/chat/dist/index.js", "chat"), false, "dist is not source");
  eq(isSource("packages/other/src/a.ts", "chat"), false, "another package's source is not ours");
});

// ── AC#4, end to end: the CLI actually exits non-zero ───────────────────────

check("AC#4 the CLI EXITS NON-ZERO on a fabricated entry (real git, real exit code)", () => {
  const dir = mkdtempSync(join(tmpdir(), "sweep-"));
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "t@t.t");
  g("config", "user.name", "t");
  mkdirSync(join(dir, "packages/auth/src"), { recursive: true });
  writeFileSync(join(dir, "packages/auth/package.json"), pj());
  writeFileSync(join(dir, "packages/auth/src/index.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "security-review-ledger.json"),
    JSON.stringify({ "@broberg/auth": { reviewed_at_commit: "0".repeat(40) } }, null, 2));
  g("add", "-A");
  g("commit", "-qm", "init");

  const script = SWEEP;
  let code = 0, out = "";
  try {
    out = execFileSync("node", [script, "--plan"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    code = e.status;
    out = String(e.stdout ?? "") + String(e.stderr ?? "");
  }
  eq(code, 1, `exit code (output was: ${out.trim()})`);
  eq(/@broberg\/auth/.test(out), true, "the package is named in the output");
});

console.log(failures ? `\n${failures} failing\n` : "\nall green\n");
process.exit(failures ? 1 : 0);

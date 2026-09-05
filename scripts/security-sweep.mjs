#!/usr/bin/env node
// F082.1 — the ledger, and the question it makes answerable.
//
//   node scripts/security-sweep.mjs --plan
//
// WHY THIS EXISTS. Both security holes found on 2026-09-03 were months old, and
// neither tool we own could have found them: BOTH /security-review variants read
// a DIFF, and the built-in one explicitly declines to comment on what is already
// in the tree. Pointed at a clean main they find nothing — correctly, and
// forever.
//
// The move that makes it tractable is not a better reviewer. It is a LEDGER:
// "changed since its own last security review" IS a diff, so the reviewer we
// already have becomes the right tool the moment something records where it last
// looked. 27,307 standing lines become ~5-10 packages a week.
//
// THE FAILURE MODE THIS IS DESIGNED AGAINST is not missing a vulnerability. It
// is the sweep becoming a rubber stamp that marks 39 packages "reviewed" and
// thereby CLOSES the question. greppable's thesis in our own words: a green
// check that never looked is worse than no check. Hence:
//
//   · the ledger records the RANGE and the VOLUME read — a review that read
//     nothing must be legible AS a review that read nothing. A timestamp cannot
//     tell a look from a skip, and that distinction is the whole epic.
//   · a reviewed_at_commit that is not an ancestor of HEAD is an ERROR, named
//     and non-zero — never shrugged off as "assume stale". A rewritten or
//     fabricated entry is exactly the thing that would make the ledger lie, and
//     it is indistinguishable from an honest one unless something checks.
//   · the plan comes from `git diff --name-only` and nothing else. Never mtime,
//     never a directory walk: a checkout, a rebase or a fresh clone must not
//     change the answer, and a mutation harness editing the working tree must
//     not either (measured in F081.5 — turbo's tree-reading filter picked a
//     different set every run for exactly that reason).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LEDGER_NAME = "security-review-ledger.json";

/** Dependency fields that are a SUPPLY-CHAIN surface. devDependencies is
 *  deliberately absent: it never reaches a consumer's runtime, and including it
 *  would put a package in the plan every time a test helper moved — which is how
 *  a signal dies. */
export const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

/** Is this path a security-relevant SOURCE file of `pkg`?
 *
 *  Tests are excluded because they move constantly and cannot ship. Note the
 *  exclusion is `/test/` and `*.test.ts` — NOT the substring "test", which would
 *  also drop packages/chat/src/testing.ts, a real shipped module. A filter that
 *  silently drops source is the same defect as one that never ran. */
export function isSource(path, pkg) {
  if (!path.startsWith(`packages/${pkg}/src/`)) return false;
  if (path.includes("/test/") || path.includes("/__tests__/")) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return false;
  return true;
}

/** The dependency surface of a package.json TEXT, as a flat comparable map.
 *
 *  Returns null when the file is absent and the string "UNPARSEABLE" when it
 *  will not parse — three states, never merged. A parse failure that returned {}
 *  would compare equal to another parse failure and report "dependencies
 *  unchanged" about a file neither side could read. */
export function depsOf(text) {
  if (text == null) return null;
  let json;
  try { json = JSON.parse(text); } catch { return "UNPARSEABLE"; }
  const out = {};
  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(json?.[field] ?? {})) out[`${field}:${name}`] = range;
  }
  return out;
}

export function depsChanged(before, after) {
  const a = depsOf(before), b = depsOf(after);
  if (a === "UNPARSEABLE" || b === "UNPARSEABLE") return true; // cannot prove unchanged ⇒ review it
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** A git façade, injected so the planner is testable without a fixture repo.
 *  Every method reads COMMITTED state; none of them looks at the working tree. */
export function makeGit(root) {
  const g = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    head: () => g("rev-parse", "HEAD").trim(),
    isAncestor(sha) {
      try { g("merge-base", "--is-ancestor", sha, "HEAD"); return true; } catch { return false; }
    },
    diffNames(from) {
      return g("diff", "--name-only", `${from}..HEAD`).split("\n").filter(Boolean);
    },
    diffLines(from, paths) {
      if (!paths.length) return 0;
      const out = g("diff", "--numstat", `${from}..HEAD`, "--", ...paths);
      let n = 0;
      for (const line of out.split("\n").filter(Boolean)) {
        const [add, del] = line.split("\t");
        n += (Number(add) || 0) + (Number(del) || 0);
      }
      return n;
    },
    show(sha, path) {
      try { return g("show", `${sha}:${path}`); } catch { return null; }
    },
    /** Line counts for every tracked source file at HEAD, in ONE call.
     *
     *  Measured before this existed: one `git show` per file was 160 subprocesses
     *  and 2m25s wall for 2.3s of CPU — the whole cost was process spawn. The
     *  same answer via `git grep -c` is 0.1s. A weekly job nobody waits for is a
     *  weekly job nobody runs.
     *
     *  A file with ZERO lines produces no row, so callers must default to 0 —
     *  absent means empty here, not unknown, because ls-files already told us the
     *  file exists. */
    lineCountsAtHead() {
      const out = g("grep", "-I", "-c", "", "HEAD", "--", "packages/*/src/*");
      const counts = new Map();
      for (const line of out.split("\n").filter(Boolean)) {
        const m = line.match(/^HEAD:(.+):(\d+)$/);
        if (m) counts.set(m[1], Number(m[2]));
      }
      return counts;
    },
    lsFiles(glob) {
      return g("ls-files", "--", glob).split("\n").filter(Boolean);
    },
  };
}

/** The package roster, read from git's index — not a directory walk. A walk sees
 *  node_modules, dist and whatever a build left behind; the index sees what is
 *  actually in the repo. */
export function listPackages(git) {
  return git.lsFiles("packages/*/package.json")
    .map((p) => p.split("/")[1])
    .sort();
}

/**
 * What must be read this run, per package.
 *
 * Returns { plan, errors }. `errors` is not an exception because ALL bad entries
 * should be named in one run — fixing them one exception at a time is how a
 * five-minute job becomes five runs.
 */
export function buildPlan(ledger, git, packages = listPackages(git)) {
  const plan = [];
  const errors = [];
  let counts = null; // one git call, and only if something is never-reviewed

  for (const pkg of packages) {
    const name = `@broberg/${pkg}`;
    const entry = ledger?.[name];

    // NEVER REVIEWED: the whole source IS the diff. Reporting 0 lines here, or
    // "unknown", would let the biggest unreviewed package look like the smallest
    // job on the list.
    if (!entry?.reviewed_at_commit) {
      const files = git.lsFiles(`packages/${pkg}/src/*`).filter((p) => isSource(p, pkg));
      counts ??= git.lineCountsAtHead();
      const lines = files.reduce((n, f) => n + (counts.get(f) ?? 0), 0);
      plan.push({ pkg, name, reason: "never reviewed", since: null, files, lines, wholeSource: true });
      continue;
    }

    const since = entry.reviewed_at_commit;
    if (!git.isAncestor(since)) {
      errors.push(
        `${name}: reviewed_at_commit ${since} is not an ancestor of HEAD. ` +
        `The ledger claims a review at a commit this history does not contain — ` +
        `a rewritten or fabricated entry, not a stale one. Re-review the package and rewrite the entry.`
      );
      continue;
    }

    // NO PRE-FILTER BY PACKAGE PREFIX HERE, DELIBERATELY. One used to sit on
    // this line and looked like a guard; the mutation harness proved nothing
    // depended on it — isSource() and the manifest's own name are already
    // package-specific, so it could be deleted with every test still green.
    // Dead code that reads as a guard is worse than no guard: the next reader
    // trusts it.
    const changed = git.diffNames(since);
    const src = changed.filter((p) => isSource(p, pkg));

    const manifest = `packages/${pkg}/package.json`;
    const deps = changed.includes(manifest) &&
      depsChanged(git.show(since, manifest), git.show("HEAD", manifest));

    if (!src.length && !deps) continue; // genuinely unchanged since its own review

    const files = deps ? [...src, manifest] : src;
    plan.push({
      pkg, name,
      reason: deps && src.length ? "source + dependencies" : deps ? "dependencies" : "source",
      since, files,
      lines: git.diffLines(since, files),
      wholeSource: false,
    });
  }

  return { plan, errors };
}

export function readLedger(root) {
  const path = join(root, LEDGER_NAME);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

// ── CLI ──────────────────────────────────────────────────────────────────────
/** Am I being RUN, or imported by a test?
 *
 *  NOT `import.meta.url === \`file://${process.argv[1]}\``, the idiom this file
 *  started with. import.meta.url is REAL-PATHED and argv[1] is not, so on macOS
 *  — where /tmp is a symlink to /private/tmp — invoking the script through a
 *  symlinked path made this false and the whole CLI silently did nothing, exit 0.
 *  Found by the mutation harness: its temp-dir copy failed the CLI case for
 *  EVERY mutant including an unmutated one, which is a red that carries no
 *  information about the mutation it is supposed to be measuring. */
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

if (invokedDirectly) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const git = makeGit(root);

  if (!process.argv.includes("--plan")) {
    console.error("usage: security-sweep.mjs --plan");
    process.exit(2);
  }

  const { plan, errors } = buildPlan(readLedger(root), git);

  if (errors.length) {
    console.error(`\n  ✗ ${errors.length} ledger entr${errors.length === 1 ? "y is" : "ies are"} not verifiable against this history:\n`);
    for (const e of errors) console.error(`    ${e}\n`);
    process.exit(1);
  }

  const all = listPackages(git);
  if (!plan.length) {
    console.log(`✓ all ${all.length} packages reviewed at their current commit — nothing to sweep`);
    process.exit(0);
  }

  const never = plan.filter((p) => p.wholeSource);
  const delta = plan.filter((p) => !p.wholeSource);
  const totalLines = plan.reduce((n, p) => n + p.lines, 0);

  console.log(`\n  ${plan.length} of ${all.length} packages to review · ${totalLines.toLocaleString()} lines\n`);
  for (const p of [...never, ...delta].sort((a, b) => b.lines - a.lines)) {
    const range = p.since ? `since ${p.since.slice(0, 7)}` : "whole source";
    console.log(`    ${p.name.padEnd(28)} ${String(p.lines).padStart(6)} lines  ${String(p.files.length).padStart(3)} files  ${p.reason} (${range})`);
  }
  if (never.length) {
    console.log(`\n  ${never.length} have never been reviewed. Their whole source is the range — that is not a`);
    console.log(`  backlog to clear in one sitting: a ledger that SAYS 39 packages are audited is`);
    console.log(`  worse than an empty one, because it closes the question.`);
  }
  console.log();
}

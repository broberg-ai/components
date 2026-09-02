#!/usr/bin/env node
// F081.5 — run a package's mutation harness only when that package could have
// been affected by this push. Christian, 2026-09-02: "kør kun det tunge når
// pakken er ændret."
//
// WHY THIS EXISTS: wiring the six unrun harnesses into the gate (F081.2) took it
// from 3¾ minutes to 11¼. The harnesses found real defects the day they were
// switched on, so they do not come out — but an 11-minute wait on every push is
// exactly the pressure that produces a bypass, and a bypass is never announced.
//
//   node scripts/mutations-if-changed.mjs test/mutations.mjs
//
// THREE RULES, and the second and third are the ones that keep it honest.
//
// 1. THE SCOPE IS READ FROM COMMITTED REFS, NEVER FROM THE WORKING TREE.
//    Measured while writing this: `turbo run test --filter='[HEAD^1]'` reported
//    @broberg/lens-engine as changed when git said only docs/ and scripts/ had
//    changed. Cause — a mutation harness was running, so lens-engine/src was
//    mutated ON DISK, and turbo's filter reads the working tree. A selector that
//    reads a tree a harness is editing picks a different set every run. So this
//    uses `git diff --name-only BASE HEAD` and nothing else.
//
// 2. "THIS PACKAGE DID NOT CHANGE" IS NOT "NOTHING THAT AFFECTS IT CHANGED"
//    (Christian's constraint on the card). A change to an internal @broberg/*
//    dependency runs the dependent's harness too, transitively. And ANY change
//    outside packages/ and apps/ — root config, the lockfile, scripts/, the
//    hooks — runs everything, because that is the class we cannot reason about
//    cheaply and being wrong there is silent.
//
// 3. A SKIP IS ANNOUNCED, LOUDLY, WITH ITS REASON. A silent skip is
//    indistinguishable from a pass, which is the exact failure this whole epic
//    is about. If the scope cannot be determined at all, everything runs and the
//    output says why — never the reassuring branch.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// THE ROOT COMES FROM THE CALLER'S CWD, NOT FROM THIS FILE'S PATH. Deriving it
// from import.meta.url pins the script to the checkout it happens to live in —
// which works in production and makes it untestable, since a fixture repo would
// be measured against THIS repo's history. Caught by the test below going red on
// every case at once.
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(), encoding: "utf8",
}).trim();
const harness = process.argv[2];
if (!harness) {
  console.error("::error::usage: mutations-if-changed.mjs <path/to/mutations.mjs>");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const run = () => {
  execFileSync("node", [harness], { stdio: "inherit", cwd: process.cwd() });
};

/** A RELEASE RUNS EVERY HARNESS, FULL STOP (F081.5 AC#4).
 *
 *  publish.yml's gate is `uses: ./.github/workflows/test.yml`, so a tag push runs
 *  this same selector. And on a tag the natural base is the WRONG one: the tagged
 *  commit is already on main, so `merge-base origin/main HEAD` is HEAD itself, the
 *  diff is empty, and EVERY package harness would skip — on the one run that
 *  guards a publish. Measured as a design hole before it shipped, not after.
 *
 *  The card's constraint is explicit: nothing publishes on a gate that skipped its
 *  own mutation harness. So the scope optimisation simply does not apply here. */
function isRelease() {
  return process.env.GITHUB_REF_TYPE === "tag" ||
    (process.env.GITHUB_REF ?? "").startsWith("refs/tags/");
}

/** The commit this push is measured against. Never the working tree (rule 1). */
function base() {
  // GitHub sets this on a push event; it is the commit main was on before.
  const before = process.env.GITHUB_EVENT_BEFORE;
  if (before && /^[0-9a-f]{40}$/.test(before) && before !== "0".repeat(40)) {
    try { git("cat-file", "-e", before); return before; } catch { /* shallow clone */ }
  }
  for (const ref of ["origin/main", "main"]) {
    try { return git("merge-base", ref, "HEAD"); } catch { /* not fetched */ }
  }
  return null;
}

/** name -> dir, and dir -> its internal @broberg/* dependencies. */
function graph() {
  const byName = new Map();
  const deps = new Map();
  for (const area of ["packages", "apps"]) {
    const dir = join(ROOT, area);
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir)) {
      const pj = join(dir, d, "package.json");
      if (!existsSync(pj)) continue;
      const p = JSON.parse(readFileSync(pj, "utf8"));
      const rel = `${area}/${d}`;
      byName.set(p.name, rel);
      deps.set(rel, Object.keys({ ...p.dependencies, ...p.peerDependencies, ...p.devDependencies })
        .filter((x) => x.startsWith("@broberg/")));
    }
  }
  return { byName, deps };
}

const pkgDir = relative(ROOT, process.cwd()).split("/").slice(0, 2).join("/");
const b = isRelease() ? null : base();

if (isRelease()) {
  console.log(`  scope: RELEASE (${process.env.GITHUB_REF}) — every harness runs.`);
  console.log(`         Nothing publishes on a gate that skipped its own harness.`);
  run();
} else if (!b) {
  console.log(`  scope: UNKNOWN — no base commit could be resolved, so the harness RUNS.`);
  console.log(`         "could not tell" is not "nothing changed" (F081.5).`);
  run();
} else {
  const changed = git("diff", "--name-only", b, "HEAD").split("\n").filter(Boolean);
  const outside = changed.filter((f) => !f.startsWith("packages/") && !f.startsWith("apps/"));

  if (outside.length) {
    console.log(`  scope: ${outside.length} change(s) outside packages/ and apps/ — everything runs.`);
    console.log(`         e.g. ${outside.slice(0, 3).join(", ")}`);
    run();
  } else {
    const { byName, deps } = graph();
    const changedPkgs = new Set(changed.map((f) => f.split("/").slice(0, 2).join("/")));
    // Rule 2: a changed dependency pulls in everything that depends on it.
    let grew = true;
    while (grew) {
      grew = false;
      for (const [dir, ds] of deps) {
        if (changedPkgs.has(dir)) continue;
        if (ds.some((n) => byName.has(n) && changedPkgs.has(byName.get(n)))) {
          changedPkgs.add(dir);
          grew = true;
        }
      }
    }
    if (changedPkgs.has(pkgDir)) {
      run();
    } else {
      console.log(`  SKIPPED  ${harness}`);
      console.log(`           ${pkgDir} is unchanged since ${b.slice(0, 8)}, and nothing it`);
      console.log(`           depends on changed either. NOT a pass — it did not run.`);
    }
  }
}

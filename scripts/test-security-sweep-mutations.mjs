#!/usr/bin/env node
// F082.1 — mutation pass for the ledger planner.
//
//   node scripts/test-security-sweep-mutations.mjs
//
// WHAT THIS PROVES, and it is the card's AC#5 rather than a general nicety:
// breaking the src/** filter and breaking the dependencies filter must kill
// DIFFERENT named tests. If one mutation kills everything, the suite is one
// assertion wearing twenty names; if a mutation kills nothing, that filter is
// unmeasured and its rule is a comment.
//
// Every mutation runs against a COPY (SWEEP_UNDER_TEST), so the real script is
// never written to and an interrupted run cannot leave a mutant on disk. And
// every mutation asserts its ANCHOR applied — a substitution that silently
// matched nothing reads exactly like a surviving mutant, which is the lie this
// harness exists not to tell.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const SWEEP = join(REPO, "scripts", "security-sweep.mjs");
const TEST = join(REPO, "scripts", "test-security-sweep.mjs");
const original = readFileSync(SWEEP, "utf8");

const MUTATIONS = [
  {
    name: "the src/** path filter is broken — every path counts as source",
    find: `  if (!path.startsWith(\`packages/\${pkg}/src/\`)) return false;`,
    replace: `  if (false) return false;`,
    // A README now enters the plan. NOT the test cases — the /test/ and
    // *.test.ts exclusions below this line still fire, which is why breaking
    // THEM is a separate mutation. Two rules on one function, measured apart.
    expectRed: ["AC#3a"],
  },
  {
    name: "the src/** path filter is broken the other way — nothing counts as source",
    find: `export function isSource(path, pkg) {`,
    replace: `export function isSource(path, pkg) {\n  if (true) return false;`,
    expectRed: ["AC#1", "AC#3d"],
  },
  {
    name: "the TEST exclusion is broken — a test file counts as shippable source",
    find: `  if (path.includes("/test/") || path.includes("/__tests__/")) return false;`,
    replace: `  if (false) return false;`,
    expectRed: ["AC#3c"],
  },
  {
    name: "the dependencies filter is broken — a manifest change never counts",
    find: `    const deps = changed.includes(manifest) &&`,
    replace: `    const deps = false &&`,
    // ONLY the dependency cases. This is the half of AC#5 that matters: a
    // supply-chain change with our own source untouched becomes invisible.
    expectRed: ["AC#3e"],
  },
  {
    name: "the dependencies filter is broken the other way — any manifest touch counts",
    find: `      depsChanged(git.show(since, manifest), git.show("HEAD", manifest));`,
    replace: `      true;`,
    // A version bump alone now drags the package in every week.
    expectRed: ["AC#3b"],
  },
  {
    name: "the ancestor check is removed — a fabricated ledger entry is accepted",
    find: `    if (!git.isAncestor(since)) {`,
    replace: `    if (false) {`,
    expectRed: ["AC#4"],
  },
  {
    name: "a never-reviewed package reports 0 lines — the biggest job looks like the smallest",
    find: `      const lines = files.reduce((n, f) => n + (counts.get(f) ?? 0), 0);`,
    replace: `      const lines = 0;`,
    expectRed: ["AC#1"],
  },
  {
    name: "an entry with no commit is treated as reviewed — a date alone closes the question",
    find: `    if (!entry?.reviewed_at_commit) {`,
    replace: `    if (!entry) {`,
    expectRed: ["an entry with a TIMESTAMP"],
  },
  {
    name: "an unparseable manifest compares equal — 'unchanged' about a file neither side read",
    find: `  if (a === "UNPARSEABLE" || b === "UNPARSEABLE") return true;`,
    replace: `  if (false) return true;`,
    expectRed: ["UNPARSEABLE"],
  },
];

const dir = mkdtempSync(join(tmpdir(), "sweep-mut-"));
let failures = 0;

/** Run the suite against a given copy of the sweep, returning the test names
 *  that FAILED. The suite prints "  ✗ <name>" per failing case. */
function runSuite(sweepPath) {
  let out;
  try {
    out = execFileSync("node", [TEST], {
      cwd: REPO, encoding: "utf8",
      env: { ...process.env, SWEEP_UNDER_TEST: sweepPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    out = String(e.stdout ?? "") + String(e.stderr ?? "");
  }
  return out.split("\n").filter((l) => l.trim().startsWith("✗")).map((l) => l.trim().slice(2));
}

// A BASELINE, because a suite that is already red proves nothing about any
// mutation. Measured first, every run.
const baseline = runSuite(SWEEP);
if (baseline.length) {
  console.log(`✗ the suite is RED before any mutation — nothing below means anything:\n  ${baseline.join("\n  ")}`);
  process.exit(1);
}
console.log("baseline: all green\n");

for (const m of MUTATIONS) {
  const count = original.split(m.find).length - 1;
  if (count !== 1) {
    console.log(`  ✗ ${m.name}\n      ANCHOR matched ${count} times, expected exactly 1 — the mutation did not apply,`);
    console.log(`      which is indistinguishable from a surviving mutant unless asserted.`);
    failures++;
    continue;
  }

  const mutantPath = join(dir, `mutant-${MUTATIONS.indexOf(m)}.mjs`);
  writeFileSync(mutantPath, original.replace(m.find, m.replace));

  const red = runSuite(mutantPath);
  const missing = m.expectRed.filter((needle) => !red.some((name) => name.includes(needle)));

  if (!red.length) {
    console.log(`  ✗ ${m.name}\n      SURVIVED — no test noticed. That filter is unmeasured.`);
    failures++;
  } else if (missing.length) {
    console.log(`  ✗ ${m.name}\n      red: ${red.map((r) => r.split(" ")[0]).join(", ")}`);
    console.log(`      but these were expected red and were not: ${missing.join(", ")}`);
    failures++;
  } else {
    console.log(`  ✓ ${m.name}`);
    console.log(`      killed by: ${red.map((r) => r.split(" ").slice(0, 2).join(" ")).join(" · ")}`);
  }
}

console.log(failures ? `\n${failures} mutation(s) unproven\n` : `\n${MUTATIONS.length} mutations, all killed\n`);
process.exit(failures ? 1 : 0);

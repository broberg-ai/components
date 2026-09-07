#!/usr/bin/env node
// F038.16 — mutation pass for the roster bump.
//
//   node scripts/test-bump-roster-version-mutations.mjs
//
// The one it exists for: the row-brace bound. Without it a package with NO `ver`
// field swallows the NEXT package's version — a silent corruption of a row
// nobody was touching, which is strictly worse than the forgotten bump this
// whole card is about.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeMarker, clearMarker, assertRestored } from "./mutation-marker.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "bump-roster-version.mjs");
const TESTS = join(HERE, "test-bump-roster-version.mjs");
const HARNESS = "scripts/test-bump-roster-version-mutations.mjs";

const MUTATIONS = [
  {
    name: "the row-brace bound is removed, so a ver-less row eats the next row's version",
    from: `    const rowEnd = rest.indexOf("}", at);
    const window = rest.slice(at, rowEnd === -1 ? rest.length : rowEnd);`,
    to: `    const window = rest.slice(at);`,
    expectRed: ["does not consume the next row's"],
  },
  {
    name: "only the FIRST row of a package is bumped (the two-row roster defect)",
    from: `  for (;;) {`,
    to: `  for (let _once = 0; _once < 1; _once++) {`,
    expectRed: ["bumps BOTH rows"],
  },
  {
    name: "the package marker drops its closing quote — @broberg/lens then matches lens-engine",
    from: `  const marker = \`pkg:"\${pkg}"\`;`,
    to: `  const marker = \`pkg:"\${pkg}\`;`,
    expectRed: ["prefix name does not bump its longer sibling"],
  },
  {
    name: "an unchanged version still counts as a change, so the caller reports a bump that did not happen",
    from: `    if (m[1] === version) alreadyCorrect++;
    else rows++;`,
    to: `    rows++;`,
    expectRed: ["already correct"],
  },
];

const run = (file) => {
  try {
    return { code: 0, out: execFileSync("node", [file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
};

// A killed run leaves the source mutated, and mutated source reads exactly like
// working source (F081.1). Refuse on a dirty file so any interruption is one
// `git checkout --` away.
{
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "scripts/bump-roster-version.mjs"], {
    cwd: join(HERE, ".."),
    encoding: "utf8",
  }).trim();
  if (dirty) {
    console.error(`::error::refusing to mutate an uncommitted file — commit first.\n  ${dirty}`);
    process.exit(1);
  }
}

const original = readFileSync(SRC, "utf8");
writeMarker({ harness: HARNESS, file: SRC });
let problems = 0;
try {
  const base = run(TESTS);
  if (base.code !== 0) {
    console.error(`::error::the suite is RED before any mutation — nothing below means anything:\n${base.out}`);
    process.exit(1);
  }
  console.log("baseline: all green\n");

  for (const m of MUTATIONS) {
    if (original.split(m.from).length - 1 !== 1) {
      console.log(`  ✗ ${m.name}\n      ANCHOR did not match exactly once — a failed substitution reads as a surviving mutant.`);
      problems++;
      continue;
    }
    writeFileSync(SRC, original.replace(m.from, m.to));
    let r;
    try {
      r = run(TESTS);
    } finally {
      writeFileSync(SRC, original);
      assertRestored({ harness: HARNESS, file: SRC, expected: original });
    }
    const red = r.out.split("\n").filter((l) => l.includes("✗")).map((l) => l.trim());
    const missing = (m.expectRed ?? []).filter((n) => !red.some((l) => l.includes(n)));
    if (r.code === 0) {
      console.log(`  ✗ ${m.name}\n      SURVIVED — this decision is undefended.`);
      problems++;
    } else if (missing.length) {
      console.log(`  ✗ ${m.name}\n      expected RED and were not: ${missing.join(" · ")}\n      actually red: ${red.slice(0, 3).join(" · ")}`);
      problems++;
    } else {
      console.log(`  ✓ ${m.name}\n      killed by: ${red[0]?.slice(0, 76)}`);
    }
  }
} finally {
  writeFileSync(SRC, original);
  assertRestored({ harness: HARNESS, file: SRC, expected: original });
  clearMarker();
}

console.log(problems ? `\n::error::${problems} mutation(s) unproven\n` : `\n✓ ${MUTATIONS.length} mutations, all killed\n`);
process.exit(problems ? 1 : 0);

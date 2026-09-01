#!/usr/bin/env node
// F039.7 — the mutation pass for the reuse gap's honesty.
//
// The gap is served to every session at boot as its reuse to-do, so a check that
// cannot see its own failure would hand the fleet a confident wrong list. Each
// decision below is removed in turn and must turn a DISTINCT test red.
//
// Follows the F081 harness invariants: absolute source path, a saved copy back
// (never `git checkout`, which reads the INDEX), a READ-BACK after the restore,
// the shared `.mutation-running` marker, and a refusal to run on an uncommitted
// file.
//
//   node apps/discovery/mutations.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { writeMarker, clearMarker, assertRestored } from "../../scripts/mutation-marker.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SRC = join(HERE, "server.ts");
const SRC_REL = "apps/discovery/server.ts";
const HARNESS = "@discovery apps/discovery/mutations.mjs";

const MUTATIONS = [
  {
    // The defect this card fixes, restored: a session that never told us
    // anything is indistinguishable from one that adopted nothing.
    name: "the gap always claims to be self-reported",
    from: '  const gapConfidence = neverReported ? "never_reported" : "self_reported";',
    to: '  const gapConfidence = "self_reported";',
  },
  {
    // ...and the mirror image, which is just as bad: everything is unverified,
    // so the label stops discriminating and consumers learn to ignore it.
    name: "the gap always claims to be unverified",
    from: '  const gapConfidence = neverReported ? "never_reported" : "self_reported";',
    to: '  const gapConfidence = "never_reported";',
  },
  {
    // The words, not the flag. A consumer that renders the payload verbatim is
    // what actually reaches a human, and the flag alone says nothing to them.
    name: "the note stops warning that an unreported gap is UNVERIFIED",
    from: "    ? `UNVERIFIED: ${asked} has never self-reported an adoption",
    to: "    ? `${asked} has never self-reported an adoption",
  },
  {
    // Back to looking up only the name that was asked for, so an identity that
    // enrolled under another name is invisible to its own repo.
    name: "the alias union is dropped (an aliased identity's adoptions vanish)",
    from: "  const names = [primary, ...Object.keys(aliases).filter((k) => aliases[k] === primary)];",
    to: "  const names = [primary];",
  },
  {
    // The merge happens but is never disclosed. A silently merged answer is a
    // new way to be confidently wrong — the caller cannot see it happened.
    name: "the merge is no longer disclosed (merged_from is always empty)",
    from: "  const mergedFrom = names.filter((n, i) => n !== asked && perName[i].length > 0);",
    to: "  const mergedFrom = [];",
  },
  {
    // The alias resolution itself: an aliased name stops picking up its repo's
    // FLEET `pub` list, so a package owner is told it is missing itself.
    name: "owns is keyed on the asked name again, not the resolved one",
    from: "  const owns = (FLEET.find((f) => f.s === primary)?.pub ?? []).map((n: string) => `@broberg/${n}`);",
    to: "  const owns = (FLEET.find((f) => f.s === asked)?.pub ?? []).map((n: string) => `@broberg/${n}`);",
  },
];

function redSet() {
  let out = "";
  let died = false;
  try {
    out = execFileSync("npx", ["vitest", "run", "server.test.ts", "--reporter=verbose"], {
      cwd: HERE,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, ENROLL_DB_URL: ":memory:" },
    });
  } catch (e) {
    out = (e.stdout ?? "") + (e.stderr ?? "");
    died = true;
  }
  // STRIP ANSI FIRST — vitest keeps colour under CI, and an anchored /^\s*×/
  // then matches nothing. A harness that cannot READ the red it caused reports
  // a killed mutation as uncaught.
  const ESC = String.fromCharCode(27);
  const clean = out.replace(new RegExp(ESC + "\\[[0-9;]*m", "g"), "");
  const red = [
    ...new Set(clean.split("\n").filter((l) => /^\s*(×|✕)/.test(l)).map((l) => l.trim())),
  ].sort();
  return { red, died, out: clean };
}

{
  const dirty = execFileSync("git", ["status", "--porcelain", "--", SRC_REL], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (dirty) {
    console.error(
      `::error::refusing to mutate an uncommitted file — commit first.\n  ${dirty}\n` +
        `  A kill skips the restore, and mutated source reads exactly like working source.`,
    );
    process.exit(1);
  }
}

console.log("baseline (unmutated) …");
const base = redSet();
if (base.died) {
  console.error(`::error::the suite already fails before any mutation:\n${base.out.slice(-2000)}`);
  process.exit(1);
}
console.log("  0 failures — so every red below is the mutation\n");

const original = readFileSync(SRC, "utf8");
const seen = new Map();
let problems = 0;

// BEFORE the first mutation (F081.1). Written after it, the marker would leave
// open the exact window it exists to close.
writeMarker({ harness: HARNESS, file: SRC });
try {
  for (const m of MUTATIONS) {
    if (!original.includes(m.from)) {
      console.log(`ANCHOR MISSING — ${m.name}\n            the substitution matched nothing, so it never applied`);
      problems++;
      continue;
    }
    const mutated = original.replace(m.from, m.to);
    if (mutated === original) {
      console.log(`ANCHOR NO-OP — ${m.name}`);
      problems++;
      continue;
    }
    writeFileSync(SRC, mutated);
    let r;
    try {
      r = redSet();
    } finally {
      writeFileSync(SRC, original);
      assertRestored({ harness: HARNESS, file: SRC, expected: original });
    }

    // THREE OUTCOMES, NEVER TWO. "the suite died before it could report" and
    // "the suite ran and found nothing wrong" are opposite facts.
    if (r.died && !r.red.length) {
      console.log(`  UNREADABLE ${m.name}`);
      console.log(`            the suite FAILED (so it was caught) but no failing test line could`);
      console.log(`            be parsed — a defect in this harness, not evidence about the code.`);
      r.out.split("\n").filter(Boolean).slice(-6).forEach((l) => console.log(`              ${l.trim()}`));
      problems++;
      continue;
    }
    if (!r.red.length) {
      console.log(`  UNCAUGHT  ${m.name}\n            the suite stayed GREEN — this decision is undefended.`);
      problems++;
      continue;
    }
    const key = r.red.join("|");
    if (seen.has(key)) {
      console.log(`  DUPLICATE ${m.name}\n            identical red set to "${seen.get(key)}".`);
      problems++;
      continue;
    }
    seen.set(key, m.name);
    console.log(`  killed    ${m.name}  → ${r.red.length} red`);
    for (const t of r.red.slice(0, 2)) console.log(`              · ${t}`);
  }
} finally {
  clearMarker();
}

console.log("");
if (problems) {
  console.error(`::error::${problems} mutation(s) uncaught, indistinguishable or never applied.`);
  process.exit(1);
}
console.log(`✓ ${MUTATIONS.length} mutations, 0 uncaught, 0 identical red sets.`);

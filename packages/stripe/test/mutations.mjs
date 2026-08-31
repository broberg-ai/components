#!/usr/bin/env node
// F053.10 — mutation pass for the two field reads.
//
// The defect class this package is answering fails in the GREEN direction: a
// field moves, the read returns undefined, and the branch quietly does not run.
// So the suite has to be shown failing, not shown passing — a green test on a
// payload that never had the problem is exactly what both outages already had.
//
// THREE PROPERTIES, and each of them has cost the fleet an hour at some point:
//   · every mutation ASSERTS ITS ANCHOR APPLIED. A substitution that matched
//     nothing reads identically to a surviving mutant, and that is the one lie
//     a mutation harness must not tell.
//   · no two mutations may produce the SAME red set. A mutation that reddens
//     everything proves the suite runs, not that it discriminates.
//   · it REFUSES to run on an uncommitted file. `finally` does not run on a
//     kill, and mutated source on disk reads exactly like working source.
//
//   node test/mutations.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// F081.1 — announce the mutated tree, and PROVE the restore took.
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(PKG, "src/fields.ts");
const SRC_REL = "src/fields.ts";

const MUTATIONS = [
  // ---- readSubscriptionId: each fallback branch, removed in turn ----------
  {
    name: "the parent.subscription_details branch is removed",
    from: "  const fromParent = asId(f.parent?.subscription_details?.subscription);",
    to: "  const fromParent = null;",
  },
  {
    name: "the invoice-LINE scan is removed",
    from: "  const lines = Array.isArray(f.lines?.data) ? f.lines.data : [];",
    to: "  const lines = [];",
  },
  {
    name: "the REMOVED legacy field is no longer read (a webhook replay breaks)",
    from: "  return asId(f.subscription);",
    to: "  return null;",
  },
  {
    // The precedence, not the presence. Only visible where both are populated
    // and disagree — every single-source case answers the same either way.
    name: "precedence swapped: the stale legacy field is read FIRST",
    from: "  const fromParent = asId(f.parent?.subscription_details?.subscription);",
    to: "  const fromParent = asId(f.subscription) ?? asId(f.parent?.subscription_details?.subscription);",
  },
  {
    // sanne's original. Kept as a mutation rather than a comment, so the
    // difference stays visible if someone ever "simplifies" it back.
    name: "back to lines.data[0] only (a proration-first invoice resolves to nothing)",
    from: "  for (const line of lines) {",
    to: "  for (const line of lines.slice(0, 1)) {",
  },
  // ---- readPeriod ---------------------------------------------------------
  {
    name: "the subscription ITEM is no longer read (the F098.4 defect, restored)",
    from: "  const item = (Array.isArray(items) ? items[0] : null) as WithPeriod | null;",
    to: "  const item = null as WithPeriod | null;",
  },
  {
    name: "the top-level fallback is removed (an older stored payload loses its dates)",
    from: "  const start = asSeconds(item?.current_period_start) ?? asSeconds(top.current_period_start);\n  const end = asSeconds(item?.current_period_end) ?? asSeconds(top.current_period_end);",
    to: "  const start = asSeconds(item?.current_period_start);\n  const end = asSeconds(item?.current_period_end);",
  },
  {
    name: "period precedence swapped: the top level wins over the item",
    from: "  const end = asSeconds(item?.current_period_end) ?? asSeconds(top.current_period_end);",
    to: "  const end = asSeconds(top.current_period_end) ?? asSeconds(item?.current_period_end);",
  },
  {
    name: "seconds are returned as seconds (the caller reads 1970)",
    from: "    end: end === null ? null : end * 1000,",
    to: "    end: end,",
  },
  {
    name: "zero counts as a date (an epoch-0 timestamp becomes a real period)",
    from: "  return typeof v === \"number\" && Number.isFinite(v) && v > 0 ? v : null;",
    to: "  return typeof v === \"number\" && Number.isFinite(v) ? v : null;",
  },
  {
    name: "an empty-string id counts as an id",
    from: "  if (typeof v === \"string\") return v || null;",
    to: "  if (typeof v === \"string\") return v;",
  },
  {
    // The whole no-throw contract. Inside a webhook a throw means the event is
    // never acknowledged and Stripe retries it forever.
    name: "the foreign-input guard is dropped from readSubscriptionId",
    from: "  if (!invoice || typeof invoice !== \"object\") return null;",
    to: "  if (false) return null;",
  },
];

function redSet() {
  let out = "";
  let died = false;
  try {
    execFileSync("npx", ["vitest", "run", "test/fields.test.ts"], { cwd: PKG, stdio: "pipe" });
  } catch (e) {
    out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
    died = true;
  }
  if (!died) return { red: [], died: false };
  // STRIP ANSI FIRST — vitest keeps colour on under CI (turbo sets FORCE_COLOR),
  // so a failing line arrives as "<esc>[31m×<esc>[39m name" and an anchored /^\s*×/
  // matches nothing. A harness that cannot READ the red it caused reports a
  // killed mutation as uncaught.
  const ESC = String.fromCharCode(27);
  const clean = out.replace(new RegExp(ESC + "\\[[0-9;]*m", "g"), "");
  const red = [
    ...new Set(clean.split("\n").filter((l) => /^\s*(×|✕|FAIL)/.test(l)).map((l) => l.trim())),
  ].sort();
  return { red, died: true };
}

{
  const dirty = execFileSync("git", ["status", "--porcelain", "--", SRC_REL], {
    cwd: PKG,
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
  console.error(`::error::the suite already fails before any mutation:\n  ${base.red.join("\n  ")}`);
  process.exit(1);
}
console.log("  0 failures — so every red below is the mutation\n");

const original = readFileSync(SRC, "utf8");
const seen = new Map();
let problems = 0;

// BEFORE the first mutation. Written after it, the marker would leave open the
// exact window it exists to close.
writeMarker({ harness: "@broberg/stripe test/mutations.mjs", file: SRC });
try {
for (const m of MUTATIONS) {
  if (!original.includes(m.from)) {
    console.log(`ANCHOR MISSING — ${m.name}\n    the substitution matched nothing, so this mutation never applied`);
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
    // The guard. A restore that FAILED is otherwise indistinguishable from one
    // that was not needed — which is how buddy's harness lost a file on
    // 2026-08-14 with a green run to show for it. Does not return on mismatch.
    assertRestored({ harness: "@broberg/stripe test/mutations.mjs", file: SRC, expected: original });
  }
  if (!r.died) {
    console.log(`  UNCAUGHT  ${m.name}\n            the suite stayed GREEN — this decision is undefended.`);
    problems++;
    continue;
  }
  if (r.red.length === 0) {
    // "it failed but I cannot see WHICH test" is a third state, and it is the
    // opposite fact from "it survived". Never merge the two.
    console.log(`  UNREADABLE ${m.name}\n            the suite FAILED (so it was caught) but no failing test line could be`);
    console.log(`            parsed. That is a defect in this harness, not evidence about the code.`);
    problems++;
    continue;
  }
  const key = r.red.join("|");
  if (seen.has(key)) {
    console.log(`  DUPLICATE ${m.name}\n            identical red set to "${seen.get(key)}" — one test carries both claims.`);
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

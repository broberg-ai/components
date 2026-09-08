#!/usr/bin/env node
// F038.17 — the rows that are NOT npm packages must reach /llms.txt.
//
//   node scripts/check-nonpkg-rows.mjs
//
// WHY THIS EXISTS. build-onboarding aggregates with `.filter((x) => x.pkg)`.
// That one clause used to drop 17 of 71 inventory rows from /ai — the surface
// CLAUDE.md orders every session to read FIRST. Measured in production
// 2026-09-08: zero of the 17 appeared. The page whose whole job is answering
// "do we already have something that does X?" answered only the npm-shaped
// quarter of the question.
//
// It asserts BY NAME, per row, never by a count: a count of 17 passes just as
// happily on 17 of the WRONG rows.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA } from "./inventory-data.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2];

const load = async (name) =>
  base
    ? await fetch(`${base.replace(/\/$/, "")}/${name}`).then((r) => r.text())
    : readFileSync(join(ROOT, "docs", name), "utf8");

const rows = DATA.flatMap((L) => (L.items || []).filter((x) => !x.pkg));

// THE FLOOR. With no pkg-less rows at all, every check below is vacuous and
// would report a confident pass on an instrument that looked at nothing.
if (rows.length === 0) {
  console.error("✗ no pkg-less rows in the inventory — this check proves NOTHING. Exit 3.");
  process.exit(3);
}

let text;
try {
  text = await load("llms.txt");
} catch (e) {
  console.error(`✗ could not read llms.txt (${e.message}). NOT a verdict on the content. Exit 2.`);
  process.exit(2);
}

const lines = text.split("\n");
const missing = [];
const unmarked = [];

for (const r of rows) {
  const line = lines.find((l) => l.includes(`**${r.nm}**`));
  if (!line) {
    missing.push(r.nm);
    continue;
  }
  // The marker must sit on the SAME LINE as the name. A reader who skims one
  // line must not be able to mistake a plan for a capability.
  const shipped = (r.s || "planned") === "shipped";
  const marker = shipped ? "NOT AN NPM PACKAGE" : "NOT BUILT YET";
  if (!line.includes(marker)) unmarked.push(`${r.nm} (expected "${marker}")`);
}

if (missing.length || unmarked.length) {
  if (missing.length)
    console.error(
      `✗ ${missing.length} of ${rows.length} non-package row(s) are MISSING from llms.txt:\n    ` +
        missing.join("\n    ") +
        `\n  This is the F038.17 defect returning: a pkg-only filter hides them from /ai.`,
    );
  if (unmarked.length)
    console.error(
      `✗ ${unmarked.length} row(s) appear WITHOUT their status marker on the same line:\n    ` +
        unmarked.join("\n    ") +
        `\n  A planned item that reads like an available one is worse than not listing it.`,
    );
  process.exit(1);
}

console.log(
  `✓ all ${rows.length} non-package rows are in llms.txt, each with its status marker ` +
    `(${rows.filter((r) => r.s === "shipped").length} shipped-not-npm, ` +
    `${rows.filter((r) => (r.s || "planned") !== "shipped").length} not-built-yet).`,
);

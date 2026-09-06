#!/usr/bin/env node
// F038.15 — /llms-full.txt must actually be full.
//
//   node scripts/check-llms-full.mjs
//
// WHAT WENT WRONG, so the next reader knows what this is defending. The two
// files were written from the SAME string — 67,393 bytes each, `cmp`
// byte-identical — and the package lines came from oneLiner(), everything before
// the first ". " or " — ". So every sentence written about a package after its
// first one reached nobody: the fleet's own CLAUDE.md tells ~30 repos to fetch
// this surface FIRST and promises "nothing behind a further link", and the full
// text lived only in the dashboard HTML and the JSON API — behind exactly that
// link. A file named `full` that is a copy of the summary is not a gap a reader
// can notice, which is why it stood.
//
// WHAT THIS ASSERTS, and the distinction is the whole point:
//
//   NOT "the two files differ"          — they can differ and full still be cut
//   BUT "every package's COMPLETE desc  — the invariant, checked on all 54 rows
//        is present in llms-full.txt"
//
// cardmem made that correction while this was being built, and it is the right
// one: if oneLiner() were removed from only ONE of the two package renderers,
// `cmp` would report a difference and the file would still be truncated. So the
// difference check is kept as a cheap first signal and is NOT the evidence.
//
// Exit 0 pass · exit 1 a real failure, with the rows named · exit 3 the check
// could not discriminate (see the floor below).
import { readFileSync } from "node:fs";
import { DATA, oneLiner } from "./inventory-data.mjs";

const read = (p) => readFileSync(new URL(`../docs/${p}`, import.meta.url), "utf8");
const SHORT = "llms.txt";
const FULL = "llms-full.txt";

const short = read(SHORT);
const full = read(FULL);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

const packages = DATA.flatMap((L) => (L.items || []).filter((x) => x.pkg)).map((p) => ({
  pkg: p.pkg,
  full: norm(p.desc ?? p.nm),
  short: oneLiner(p),
}));

const fail = [];

// 1 — the cheap signal. One line re-aliased the two files for months; it would
// take one line to do it again.
if (short === full) {
  fail.push(
    `docs/${SHORT} and docs/${FULL} are BYTE-IDENTICAL (${short.length} bytes each).\n` +
      `      They are two surfaces with two jobs: ${SHORT} is the one-line map, ${FULL} is every\n` +
      `      sentence. Writing one string to both is how this defect shipped the first time.`,
  );
}

// 2 — THE INVARIANT. Every row's complete description, present in full.
const truncated = packages.filter((p) => p.full && !full.includes(p.full));
if (truncated.length) {
  fail.push(
    `${truncated.length} of ${packages.length} package descriptions are NOT complete in docs/${FULL}:\n` +
      truncated
        .slice(0, 8)
        .map((p) => `        ${p.pkg} — has ${p.full.length} chars of desc, cut in the file`)
        .join("\n") +
      (truncated.length > 8 ? `\n        …and ${truncated.length - 8} more` : ""),
  );
}

// 3 — and the map stayed a map. The opposite remedy — putting every full
// description into llms.txt as well — passes check 2 and destroys the thing
// llms.txt is for: a session paying for 54 full descriptions to learn that a
// package exists.
const tailed = packages.filter((p) => p.full && p.full !== p.short && p.full.length > p.short.length);
const leaked = tailed.filter((p) => short.includes(p.full));
if (leaked.length) {
  fail.push(
    `${leaked.length} full description(s) have leaked into docs/${SHORT}, which is the MAP:\n` +
      leaked.slice(0, 8).map((p) => `        ${p.pkg}`).join("\n") +
      `\n      Fixing truncation by making both files long is the same failure from the other side.`,
  );
}

// THE FLOOR. Checks 2 and 3 are both vacuous if no row has anything after its
// first sentence — every desc would equal its own one-liner and the file would
// pass while telling a reader nothing. A check that cannot discriminate must say
// so instead of reporting a pass; this repo has already shipped one green that
// meant "nothing to look at" and read as "nothing wrong".
if (!tailed.length) {
  console.error(
    `✗ ${packages.length} packages and NOT ONE has content after its first sentence.\n` +
      `  That is an instrument problem, not a pass: with no tailed row, neither the\n` +
      `  completeness check nor the leak check can fail, and this run proves nothing.`,
  );
  process.exit(3);
}

if (fail.length) {
  console.error(`✗ docs/${FULL} is not doing what its name says:\n`);
  for (const f of fail) console.error(`  · ${f}\n`);
  console.error(`  Fix: bun scripts/build-onboarding.mjs, then commit docs/.`);
  process.exit(1);
}

const longest = tailed.reduce((a, b) => (b.full.length > a.full.length ? b : a));
console.log(
  `✓ docs/${FULL} carries all ${packages.length} complete descriptions ` +
    `(${Buffer.byteLength(full).toLocaleString("en-US")} bytes vs ${Buffer.byteLength(short).toLocaleString("en-US")}).\n` +
    `  ${tailed.length} rows have content past the first sentence — longest is ${longest.pkg} ` +
    `at ${longest.full.length} chars, of which ${longest.short.length} reach ${SHORT}.`,
);

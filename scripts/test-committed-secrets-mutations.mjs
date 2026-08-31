#!/usr/bin/env node
// F061.6 — mutation pass for the CI committed-secret guard.
//
// Every mutation is applied to a COPY and run via SECRETS_CHECK. The real
// scripts/check-committed-secrets.mjs is never written to, so an interrupted run
// cannot leave a mutant on disk — the failure mode where a harness kills itself
// mid-mutation and the "restore" never happens.
//
// Every mutation asserts its ANCHOR applied. A substitution that silently matched
// nothing reads exactly like a surviving mutant, and that is the lie this harness
// exists to not tell.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const CHECK = join(REPO, "scripts", "check-committed-secrets.mjs");
const TEST = join(REPO, "scripts", "test-committed-secrets-check.mjs");
const original = readFileSync(CHECK, "utf8");

const MUTATIONS = [
  {
    // The whole point of the guard. If it cannot see a planted key, nothing else
    // it reports means anything.
    name: "findings are collected but never reported (always exits 0)",
    find: "if (findings.length) {",
    replace: "if (false) {",
    expect: "fails",
  },
  {
    // THE FAITHFUL REPRODUCTION of F061.5's defect one level up: a missing
    // scanner exits 0 and reads as a clean tree.
    name: "a missing scanner exits 0 (the F061.5 defect, at the CI layer)",
    find: `if (!existsSync(SCAN)) {
  die(`,
    replace: `if (!existsSync(SCAN)) {
  process.exit(0);
}
if (false) {
  die(`,
    expect: "fails rather than skipping",
  },
  {
    // The SAME line removed a different way, and it is worth its own mutation
    // because of what it proved: with the guard simply gone, the await import
    // below throws and node exits 1 — so the EXIT-CODE assertion still passes and
    // only the MESSAGE assertion goes red. A check asserting `code === 1` alone
    // would have called this a kill while the operator got a raw module-not-found
    // stack instead of "the scanner is not built". That is why every case in the
    // suite asserts the message, and this mutation is what demonstrates it.
    name: "the guard is removed, so it dies on the import with a raw stack",
    find: `if (!existsSync(SCAN)) {
  die(\`  ✗ cannot scan for committed credentials`,
    replace: `if (false) {
  die(\`  ✗ cannot scan for committed credentials`,
    expect: "says the SCANNER is missing, not that the tree is clean",
  },
  {
    // The false green found in this card's own review gate: reading the working
    // tree instead of the committed blob.
    name: "reads the working tree instead of the committed blob",
    find: "  const buf = blobs.get(rel);\n  if (!buf) { unreadable++; continue; }",
    replace: "  let buf;\n  try { buf = readFileSync(join(REPO, rel)); } catch { unreadable++; continue; }",
    expect: "the committed credential is still found",
  },
  {
    // A run that read nothing satisfies findings.length === 0.
    name: "scanning zero files reports clean",
    find: "if (scanned === 0) {",
    replace: "if (false) {",
    expect: "fails on an empty file list",
  },
  {
    // The card's constraint: a count tells the next reader nothing about where
    // to look. Dropping the line number must be caught.
    name: "the line number is dropped from the finding",
    find: "      : `${f.file}:${f.line}`;",
    replace: "      : `${f.file}`;",
    expect: "names the file AND the line, not a count",
  },
  {
    // If exclusions were ignored, the guard would fire on the scanner's own
    // fixtures and CI would disagree with the hook about what is allowed.
    name: ".secretscanignore is ignored",
    find: "      .map((p) => `:(exclude)${p}`)",
    replace: "      .map((p) => `:(exclude)__never_matches_${p}`)",
    expect: "an exempted path is not scanned",
  },
  {
    // A narrowing step that fails must not delete the finding it was narrowing.
    name: "a finding whose line cannot be pinned is silently dropped",
    find: `    for (const f of hits) {
      findings.push({ file: rel, line: null, label: f.label, spansLines: true });
    }`,
    replace: "    /* dropped */",
    expect: "still fails",
  },
];

let uncaught = 0;
const redSets = [];

for (const m of MUTATIONS) {
  if (!original.includes(m.find)) {
    console.log(`ANCHOR MISSING — ${m.name}\n  the substitution matched nothing, so this mutation was never applied`);
    uncaught++;
    continue;
  }
  const mutated = original.replace(m.find, m.replace);
  if (mutated === original) { console.log(`ANCHOR NO-OP — ${m.name}`); uncaught++; continue; }

  const dir = mkdtempSync(join(tmpdir(), "csecmut-"));
  const path = join(dir, "check-committed-secrets.mjs");
  writeFileSync(path, mutated, { mode: 0o755 });

  let out = "";
  let died = false;
  try {
    execFileSync("node", [TEST], { env: { ...process.env, SECRETS_CHECK: path }, stdio: "pipe" });
  } catch (e) {
    out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
    died = true;
  }
  if (!died) {
    console.log(`UNCAUGHT — ${m.name}\n  the suite stayed GREEN with this mutation applied`);
    uncaught++;
    continue;
  }
  const red = out.split("\n").filter((l) => l.trimStart().startsWith("FAIL")).map((l) => l.trim());
  const hit = red.some((l) => l.includes(m.expect));
  redSets.push(red.join("|"));
  console.log(`${hit ? "killed" : "WRONG RED"} — ${m.name}`);
  red.forEach((l) => console.log(`     ${l}`));
  if (!hit) uncaught++;
}

const identical = redSets.length !== new Set(redSets).size;
if (identical) console.log("\nWARNING: two mutations produced IDENTICAL red sets — one test may be carrying both");
console.log(`\n${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets`);
process.exit(uncaught === 0 && !identical ? 0 : 1);

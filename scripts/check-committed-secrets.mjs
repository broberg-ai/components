#!/usr/bin/env node
// F061.6 — the SECOND guard: scan the whole tracked tree for credentials.
//
// .githooks/pre-commit is fast feedback, not the guard. It is absent on a clone
// that never ran `pnpm install` (which is what sets core.hooksPath), it is
// bypassable with --no-verify, and until F061.5 it was silently off whenever
// @broberg/secret-scan was not built. This runs in CI, where none of those are
// true, and every publish job depends on it through the workspace gate.
//
// It scans the FULL tree, not the diff: a key committed before this file existed
// must still be found. The hook answers "are you adding one"; this answers "is
// one in here".
//
// Three ways to fail, and they are deliberately different messages — a scanner
// that could not run and a tree that is clean must never look alike (F061.5).

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const SCAN = join(REPO, "packages", "secret-scan", "dist", "index.js");

const die = (msg) => { console.error(`\n${msg}\n`); process.exit(1); };

// 1. The scanner must exist. Same rule as the hook, one level up: an
//    unanswerable question reads as UNANSWERED, never as COMPLIANT.
if (!existsSync(SCAN)) {
  die(`  ✗ cannot scan for committed credentials — @broberg/secret-scan is not built.
    This is the repo's CI-side secret guard, so a missing scanner is a failure,
    not a skip. Build it:

      pnpm --filter @broberg/secret-scan build`);
}
const { redactSecrets } = await import(SCAN);

// 2. Same exclusion source as the hook, so CI and the hook cannot disagree about
//    what is allowed. A scanner's own fixtures have to look like credentials.
const ignoreFile = join(REPO, ".secretscanignore");
const excludes = existsSync(ignoreFile)
  ? readFileSync(ignoreFile, "utf8").split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((p) => `:(exclude)${p}`)
  : [];

// Read the COMMITTED blobs, not the working tree. This script's name is a claim
// about the repository, and the working tree is a different thing: a secret that
// is committed and then edited out locally without committing leaves the repo
// carrying it while `readFileSync` returns the clean version. Measured — that
// exact case reported "no credentials in the tracked tree" while `git show
// HEAD:src.js` still held the key. Harmless in CI (a fresh checkout IS HEAD) and
// a false green everywhere else, which is the shape this repo keeps naming.
//
// `git ls-files -s` gives each path's blob sha, and one `git cat-file --batch`
// streams every blob in a SINGLE process — 780 subprocesses would have been the
// obvious way and is why the naive fix looks too expensive to bother with.
const entries = execFileSync("git", ["ls-files", "-s", "-z", "--", ".", ...excludes], {
  cwd: REPO,
  maxBuffer: 1 << 28,
}).toString().split("\0").filter(Boolean).map((l) => {
  const tab = l.indexOf("\t");
  return { sha: l.slice(0, tab).split(" ")[1], path: l.slice(tab + 1) };
});

// `<sha> <type> <size>\n<content>\n` per entry, in input order.
const blobs = new Map();
if (entries.length) {
  const batch = execFileSync("git", ["cat-file", "--batch"], {
    cwd: REPO,
    input: entries.map((e) => e.sha).join("\n") + "\n",
    maxBuffer: 1 << 29,
  });
  let off = 0;
  for (const e of entries) {
    const nl = batch.indexOf(0x0a, off);
    if (nl === -1) break;
    const size = Number(batch.toString("ascii", off, nl).split(" ")[2]);
    if (!Number.isFinite(size)) break;
    blobs.set(e.path, batch.subarray(nl + 1, nl + 1 + size));
    off = nl + 1 + size + 1;
  }
}
const files = entries.map((e) => e.path);

const real = (text) =>
  (redactSecrets(text, { announced: true }).findings ?? [])
    .filter((f) => f.label !== "announced-secret");

let scanned = 0;
let unreadable = 0;
const findings = [];

for (const rel of files) {
  const buf = blobs.get(rel);
  if (!buf) { unreadable++; continue; }
  // A NUL byte or invalid UTF-8 means this is not text we can search. Counted,
  // never silently dropped — an unread file is not a clean file.
  if (buf.includes(0)) { unreadable++; continue; }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { unreadable++; continue; }
  scanned++;

  const hits = real(text);
  if (!hits.length) continue;

  // Narrow to LINES by re-running the same function per line — never a second
  // implementation of the matching, which would be free to disagree with the one
  // that found it. A multi-line pattern (a PEM block) will not re-match on any
  // single line; that case is reported WITHOUT a line number and says so, rather
  // than vanishing because the narrowing failed.
  const lines = text.split("\n");
  const located = [];
  for (let i = 0; i < lines.length; i++) {
    for (const f of real(lines[i])) located.push({ line: i + 1, label: f.label });
  }
  if (located.length) {
    for (const l of located) findings.push({ file: rel, line: l.line, label: l.label });
  } else {
    for (const f of hits) {
      findings.push({ file: rel, line: null, label: f.label, spansLines: true });
    }
  }
}

// 3. A run that read NOTHING must not report clean. `findings.length === 0`
//    is satisfied by an empty file list, and the likely cause of an empty list
//    is a wrong cwd or a tree git does not track — i.e. exactly when a confident
//    all-clear is most wrong.
if (scanned === 0) {
  die(`  ✗ scanned 0 files — this check did not look at anything.
    ${files.length} path(s) came back from git, ${unreadable} unreadable.
    A clean result from a scan that read nothing is not a clean result.`);
}

if (findings.length) {
  console.error(`\n  ✗ ${findings.length} credential(s) found in the tracked tree:\n`);
  for (const f of findings) {
    const where = f.line === null
      ? `${f.file}  (spans multiple lines)`
      : `${f.file}:${f.line}`;
    console.error(`      ${where}  —  ${f.label}`);
  }
  console.error(`
    These are in the repository, not merely in your staged diff. Remove the value,
    read it from the environment instead, and ROTATE it — it is in git history and
    deleting the line does not un-publish it.

    A fixture that must look like a credential belongs in .secretscanignore, with
    the reason written beside it. An exemption is a hole in the guard; add one only
    when the value is genuinely public (a vendor's documentation example).
`);
  process.exit(1);
}

console.log(
  `✓ no credentials in the tracked tree — ${scanned} file(s) scanned, ` +
  `${unreadable} unreadable (binary/non-UTF-8), ${excludes.length} exemption(s)`
);

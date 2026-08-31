#!/usr/bin/env node
// F061.4 — the pre-commit secret gate must refuse a commit that ADDS a credential
// and ALLOW one that REMOVES it.
//
// Runs the REAL .githooks/pre-commit inside a throwaway git repo, because the
// thing under test is a shell script reading `git diff --cached` — a unit test of
// its logic re-typed in JS would prove that my re-typing works, not that the hook
// does.
//
// No credential is written literally in this file. Every fixture key is assembled
// at runtime from fragments, so this script needs no .secretscanignore exemption.
// An exemption is a hole in the gate; a concatenation is not.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
// GATE_HOOK lets the mutation harness point this at a MUTATED COPY. The real
// hook is never edited — so a killed run has nothing to restore, and the class of
// bug where a crashed harness leaves a mutant on disk cannot happen here.
const HOOK = process.env.GATE_HOOK || join(REPO, ".githooks", "pre-commit");
const SCAN = join(REPO, "packages", "secret-scan", "dist", "index.js");

// Assembled, never literal.
const AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE";
const ENV_VALUE = "wh_" + "s3cret".repeat(4) + "_zz";   // >12 chars, so layer 2 looks at it

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}  (blocked=${actual}, want blocked=${expected})`);
};

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "gate-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  // Fixture commit is made BEFORE the hook is installed — never with --no-verify.
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git("add", "-A");
  git("commit", "-qm", "seed");
  mkdirSync(join(dir, ".githooks"), { recursive: true });
  copyFileSync(HOOK, join(dir, ".githooks", "pre-commit"));
  execFileSync("chmod", ["+x", join(dir, ".githooks", "pre-commit")]);
  mkdirSync(join(dir, "packages", "secret-scan", "dist"), { recursive: true });
  copyFileSync(SCAN, join(dir, "packages", "secret-scan", "dist", "index.js"));
  writeFileSync(join(dir, ".env"), `WEBHOOK_SECRET=${ENV_VALUE}\n`);
  // .env MUST be ignored in the fixture repo. Without this, `git add -A` stages it
  // and LAYER 1 blocks every commit — which would make each "adding a credential is
  // REFUSED" check pass for the wrong reason, and the exclude check fail for the
  // wrong reason. Found by this test disagreeing with itself.
  writeFileSync(join(dir, ".gitignore"), ".env\n");
  git("config", "core.hooksPath", ".githooks");
  return { dir, git };
}

// Returns true when the hook BLOCKED the commit.
function commitBlocked(dir, git, msg) {
  try { git("commit", "-qm", msg); return false; }
  catch { return true; }
}

function seedFileWithSecret(dir, git, name, body) {
  git("config", "--unset", "core.hooksPath");
  writeFileSync(join(dir, name), body);
  git("add", "-A");
  git("commit", "-qm", "fixture");
  git("config", "core.hooksPath", ".githooks");
}

console.log("pre-commit secret gate — both directions, both layers\n");

for (const [layer, secret] of [["layer 3 (format)", AWS_KEY], ["layer 2 (.env value)", ENV_VALUE]]) {
  console.log(layer);

  // ADD — must be refused.
  {
    const { dir, git } = makeRepo();
    writeFileSync(join(dir, "added.txt"), `key = ${secret}\n`);
    git("add", "-A");
    check("adding a credential is REFUSED", commitBlocked(dir, git, "add"), true);
    rmSync(dir, { recursive: true, force: true });
  }

  // REMOVE — must be allowed.
  {
    const { dir, git } = makeRepo();
    seedFileWithSecret(dir, git, "leaked.txt", `key = ${secret}\n`);
    rmSync(join(dir, "leaked.txt"));
    git("add", "-A");
    check("removing a credential is ALLOWED", commitBlocked(dir, git, "remove"), false);
    rmSync(dir, { recursive: true, force: true });
  }
}

// A pure deletion produces a diff with zero added lines — the case that trips
// `set -euo pipefail` if the extraction treats "grep found nothing" as an error.
{
  console.log("pure deletion (zero added lines)");
  const { dir, git } = makeRepo();
  seedFileWithSecret(dir, git, "plain.txt", "nothing interesting\n");
  rmSync(join(dir, "plain.txt"));
  git("add", "-A");
  check("hook does not abort on a diff with no added lines", commitBlocked(dir, git, "del"), false);
  rmSync(dir, { recursive: true, force: true });
}

// .secretscanignore must still narrow layer 3.
{
  console.log(".secretscanignore");
  const { dir, git } = makeRepo();
  writeFileSync(join(dir, ".secretscanignore"), "fixtures/\n");
  mkdirSync(join(dir, "fixtures"), { recursive: true });
  writeFileSync(join(dir, "fixtures", "keys.txt"), `key = ${AWS_KEY}\n`);
  git("add", "-A");
  check("an excluded path is still not scanned", commitBlocked(dir, git, "excluded"), false);
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);

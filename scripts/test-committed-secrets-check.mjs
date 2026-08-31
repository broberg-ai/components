#!/usr/bin/env node
// F061.6 — the CI secret guard must be able to FAIL, in five distinguishable ways.
//
// Runs the REAL scripts/check-committed-secrets.mjs inside throwaway git repos.
// A unit test of its logic re-typed here would prove that my re-typing works.
//
// The point of the five cases is not coverage for its own sake: "clean",
// "scanner missing" and "read nothing" all produce zero findings, and a check
// that reports them identically is the exact defect F061.5 fixed one level down.
// So every case asserts the MESSAGE, not just the exit code.
//
// No credential is written literally here — every fixture key is assembled at
// runtime, so this file needs no .secretscanignore exemption. An exemption is a
// hole in the guard; a concatenation is not.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const CHECK = process.env.SECRETS_CHECK || join(REPO, "scripts", "check-committed-secrets.mjs");
const SCAN = join(REPO, "packages", "secret-scan", "dist", "index.js");

if (!existsSync(SCAN)) {
  console.log("building @broberg/secret-scan (no dist — clean checkout)\n");
  execFileSync("pnpm", ["--filter", "@broberg/secret-scan", "build"], { cwd: REPO, stdio: "inherit" });
}

const AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

function makeRepo({ withScanner = true, files = {}, ignore = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "csec-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  // The scanner lives under packages/, which the check resolves from the repo
  // root — so a fixture without it reproduces a clean checkout exactly.
  if (withScanner) {
    mkdirSync(join(dir, "packages", "secret-scan", "dist"), { recursive: true });
    copyFileSync(SCAN, join(dir, "packages", "secret-scan", "dist", "index.js"));
  }
  // node treats a .mjs as ESM regardless, but without this the fixture inherits
  // /tmp's absent package.json and node prints a MODULE_TYPELESS warning that
  // pollutes the very stderr these cases assert on.
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  if (ignore !== null) writeFileSync(join(dir, ".secretscanignore"), ignore);
  git("add", "-A");
  git("commit", "-qm", "fixture");
  return { dir, git };
}

// Returns { code, out } from running the REAL check in that repo.
function run(dir) {
  try {
    const out = execFileSync("node", [CHECK], { cwd: dir, stdio: "pipe" });
    return { code: 0, out: out.toString() };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

console.log("CI committed-secret guard — five distinguishable outcomes\n");

// 1. A credential in the tree is found, and located by FILE AND LINE.
{
  console.log("a credential in the tracked tree");
  const { dir } = makeRepo({ files: { "src/leaked.js": `const k = "${AWS_KEY}";\n`, "src/fine.js": "ok\n" } });
  const { code, out } = run(dir);
  check("fails", code === 1, `(exit=${code})`);
  check("names the file AND the line, not a count", /src\/leaked\.js:1\b/.test(out));
  check("names the pattern that matched", out.includes("aws-access-key-id"));
  check("tells the reader to ROTATE it", out.includes("ROTATE"));
  rmSync(dir, { recursive: true, force: true });
}

// 2. The same tree without the credential passes — so case 1 failed because of
//    the key, not because the check refuses everything.
{
  console.log("the same tree, credential removed");
  const { dir } = makeRepo({ files: { "src/fine.js": "ok\n" } });
  const { code, out } = run(dir);
  check("passes", code === 0, `(exit=${code})`);
  check("reports how many files it actually READ", /\d+ file\(s\) scanned/.test(out));
  rmSync(dir, { recursive: true, force: true });
}

// 3. .secretscanignore narrows it exactly as the hook does. If CI and the hook
//    disagreed about what is allowed, a developer would learn which one is right
//    by being blocked.
{
  console.log(".secretscanignore parity with the hook");
  const { dir } = makeRepo({
    files: { "src/leaked.js": `const k = "${AWS_KEY}";\n` },
    ignore: "# vendor documentation example\nsrc/leaked.js\n",
  });
  const { code, out } = run(dir);
  check("an exempted path is not scanned", code === 0, `(exit=${code})`);
  check("and the exemption is COUNTED in the output, not silent", /1 exemption\(s\)/.test(out));
  rmSync(dir, { recursive: true, force: true });
}

// 4. THE CASE THIS FILE EXISTS FOR. A missing scanner produces zero findings,
//    exactly like a clean tree. It must not read as clean.
{
  console.log("scanner not built");
  const { dir } = makeRepo({ withScanner: false, files: { "src/leaked.js": `const k = "${AWS_KEY}";\n` } });
  const { code, out } = run(dir);
  check("fails rather than skipping", code === 1, `(exit=${code})`);
  check("says the SCANNER is missing, not that the tree is clean", out.includes("is not built"));
  check("and does not claim a clean tree", !out.includes("no credentials in the tracked tree"));
  rmSync(dir, { recursive: true, force: true });
}

// 5. A run that read NOTHING. `findings.length === 0` is satisfied by an empty
//    file list, and the likely cause is a wrong directory — i.e. precisely when a
//    confident all-clear is most wrong.
{
  console.log("nothing to scan");
  const dir = mkdtempSync(join(tmpdir(), "csec-empty-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, "packages", "secret-scan", "dist"), { recursive: true });
  copyFileSync(SCAN, join(dir, "packages", "secret-scan", "dist", "index.js"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  const { code, out } = run(dir);
  check("fails on an empty file list", code === 1, `(exit=${code})`);
  check("says it did not look at anything", out.includes("did not look at anything"));
  check("and does not claim a clean tree", !out.includes("no credentials in the tracked tree"));
  rmSync(dir, { recursive: true, force: true });
}

// 6. A multi-line pattern (a PEM block) cannot re-match on any single line, so
//    the line-narrowing finds nothing. It must still be REPORTED — a narrowing
//    step that fails must not delete the finding it was narrowing.
{
  console.log("a credential spanning multiple lines");
  // The BEGIN/END markers are assembled too, not just the body. Written literally
  // they ARE the pattern — the regex matches the markers with anything between
  // them — so this file would need a .secretscanignore exemption to exist. It has
  // none, and that is the point: an exemption is a hole in the guard.
  // (Found by the pre-commit hook refusing this very commit. The first draft
  // assembled only the body and I claimed in the commit message that no exemption
  // was needed — true of the AWS fixture, false of this one, and the gate caught
  // the claim in the same turn I wrote it.)
  const DASHES = "-".repeat(5);
  const KIND = "RSA PRIVATE " + "KEY";
  const pem = [
    `${DASHES}BEGIN ${KIND}${DASHES}`,
    "MIIEowIBAAKCAQEA" + "x".repeat(48),
    `${DASHES}END ${KIND}${DASHES}`,
    "",
  ].join("\n");
  const { dir } = makeRepo({ files: { "src/key.pem": pem } });
  const { code, out } = run(dir);
  check("still fails", code === 1, `(exit=${code})`);
  check("reports the file", out.includes("src/key.pem"));
  check("and SAYS the line could not be pinned rather than dropping it", out.includes("spans multiple lines"));
  rmSync(dir, { recursive: true, force: true });
}

// 7. THE FALSE GREEN THIS SCRIPT'S OWN NAME INVITES. A secret that is COMMITTED
//    and then edited out of the working tree without committing leaves the repo
//    carrying it. Reading from disk reports clean; reading the committed blob does
//    not. Found by reviewing this card in its own auto-review gate, and measured
//    before it was fixed — the check said "no credentials in the tracked tree"
//    while `git show HEAD:src.js` still held the key.
{
  console.log("committed but edited out of the working tree");
  const { dir, git } = makeRepo({ files: { "src.js": `const k = "${AWS_KEY}";\n` } });
  // The fixture commit already carries the key. Now clean ONLY the working tree.
  writeFileSync(join(dir, "src.js"), 'const k = "harmless";\n');
  const committed = git("show", "HEAD:src.js").toString();
  const onDisk = readFileSync(join(dir, "src.js"), "utf8");
  check("fixture is set up: committed and working tree DIFFER",
    committed.includes(AWS_KEY) && !onDisk.includes(AWS_KEY));
  const { code, out } = run(dir);
  check("the committed credential is still found", code === 1, `(exit=${code})`);
  check("and it is located in the file", /src\.js:1\b/.test(out));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);

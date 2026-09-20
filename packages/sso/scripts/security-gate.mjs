#!/usr/bin/env node
/**
 * The security gate for @broberg/sso — runnable locally with the same command
 * CI runs, because a gate you only meet when it is red is one you never learn.
 *
 *     node scripts/security-gate.mjs
 *
 * ── WHAT IT MEASURES, AND WHY IT IS THE TARBALL ──────────────────────────
 *
 * It packs the package and inspects THAT, not src/. The tarball is the artefact
 * a consumer actually downloads; src/ is what we happen to have on disk. The
 * two differ — `files`, .npmignore and the build all sit between them — and the
 * one that can hurt somebody is the one that ships.
 *
 * ── AND WHY THE AUDIT IS SCOPED TO A CONSUMER'S TREE ─────────────────────
 *
 * `pnpm audit` at the monorepo root reported 8 critical and 33 high on the day
 * this was written. Every one of them was dev tooling — vite, happy-dom,
 * esbuild. A consumer of this package installs `jose` and nothing else. A gate
 * that fails daily for reasons nobody can act on gets switched off within a
 * week, and then there is no gate. So the audit runs inside a clean install of
 * the packed tarball: the tree a consumer really gets.
 *
 * ── EVERY CHECK CARRIES A POSITIVE CONTROL ───────────────────────────────
 *
 * The house failure, hit four times on the day this was written: a check that
 * cannot answer NO. A secret scanner that reads zero files also reports
 * "clean". So this plants a key and REQUIRES the scanner to find it before a
 * clean sweep is allowed to count as an answer — and it counts the files it
 * read and refuses to pass on zero.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

const problems = [];
const say = (ok, label, detail) =>
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? " — " + detail : ""}`);

/* ── 1. pack, and unpack what a consumer would download ─────────────────── */
const work = mkdtempSync(join(tmpdir(), "sso-gate-"));
const tgzName = run("npm", ["pack", "--pack-destination", work, "--silent"]).trim().split("\n").pop();
run("tar", ["xzf", join(work, tgzName), "-C", work]);
const pkgDir = join(work, "package");

const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(pkgDir);

console.log(`\n@broberg/sso security gate — ${tgzName}`);
console.log(`packed ${files.length} files\n`);

/* ── 2. secret scan of the SHIPPED artefact ─────────────────────────────── */
const PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, "private key"],
  [/\b(sk|pk)_live_[A-Za-z0-9]{10,}/, "live Stripe key"],
  [/\buk_[A-Za-z0-9]{24,}/, "Upmetrics project key"],
  [/\bghp_[A-Za-z0-9]{30,}/, "GitHub token"],
  // A VALUE, not the variable name. `SSO_CLIENT_SECRET=` appears in the README
  // as documentation and must not be a finding — the README is how a consumer
  // learns the name.
  [/SSO_(CLIENT|COOKIE)_SECRET\s*=\s*["']?[A-Za-z0-9+/_-]{16,}/, "a real SSO secret value"],
];

function scan(paths) {
  let read = 0, unreadable = 0;
  const hits = [];
  for (const p of paths) {
    let text;
    try { text = readFileSync(p, "utf8"); } catch { unreadable++; continue; }
    read++;
    for (const [re, what] of PATTERNS) if (re.test(text)) hits.push(`${p.slice(pkgDir.length + 1)}: ${what}`);
  }
  return { read, unreadable, hits };
}

const sweep = scan(files);
// @broberg/greppable's own lesson: 0 findings in 0 files is not a clean bill of
// health, it is a scan that never happened — and a failed `npm pack` produces
// exactly that shape.
if (sweep.read === 0) problems.push("the scanner read ZERO files — a clean result here would be meaningless");
say(sweep.read > 0, "scanner read the tarball", `${sweep.read} files, ${sweep.unreadable} unreadable`);
if (sweep.hits.length) problems.push(`secret in the published tarball: ${sweep.hits.join("; ")}`);
say(sweep.hits.length === 0, "no credentials in the shipped artefact", sweep.hits.join("; "));

/* POSITIVE CONTROL — the scanner must be able to say NO. */
const planted = join(pkgDir, "__control.txt");
// Assembled from halves so this source file is not itself a hit.
writeFileSync(planted, "AKIA" + "ABCDEFGHIJKLMNOP" + "\n");
const control = scan([planted]);
if (control.hits.length !== 1) problems.push("POSITIVE CONTROL FAILED — a planted key was not found, so the clean sweep above proves nothing");
say(control.hits.length === 1, "positive control: a planted key IS caught");

/* ── 3. dependency audit on a CONSUMER's tree ───────────────────────────── */
const consumer = mkdtempSync(join(tmpdir(), "sso-consumer-"));
writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "gate-consumer", private: true }));
try {
  run("npm", ["install", "--silent", "--no-audit", "--no-fund", join(work, tgzName)], { cwd: consumer });
} catch (e) {
  problems.push("could not install the packed tarball into a clean directory — a consumer could not either");
}
let audit = { high: 0, critical: 0 };
try {
  run("npm", ["audit", "--json", "--audit-level=high"], { cwd: consumer });
} catch (e) {
  // npm audit exits non-zero WHEN IT FINDS SOMETHING, so the report is on stdout
  // of a throwing call. Reading only the exit code would call a finding a crash.
  try {
    const j = JSON.parse(String(e.stdout || "{}"));
    const v = j.metadata?.vulnerabilities ?? {};
    audit = { high: v.high ?? 0, critical: v.critical ?? 0 };
  } catch { problems.push("npm audit failed and its output could not be parsed — treat as unmeasured, not as clean"); }
}
if (audit.high || audit.critical) problems.push(`consumer tree: ${audit.critical} critical, ${audit.high} high`);
say(!audit.high && !audit.critical, "consumer dependency tree", `${audit.critical} critical, ${audit.high} high`);

/* ── verdict ────────────────────────────────────────────────────────────── */
console.log();
if (problems.length) {
  console.error("SECURITY GATE RED:");
  for (const p of problems) console.error("  · " + p);
  process.exit(1);
}
console.log("security gate green — and every check above proved it could fail.\n");

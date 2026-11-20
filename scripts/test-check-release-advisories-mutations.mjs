#!/usr/bin/env node
// F115.1 — mutation pass for the release advisory gate. Mutants are applied to a
// COPY; the real gate is never written. Every mutation asserts its anchor applied.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const SRC = join(REPO, "scripts", "check-release-advisories.mjs");
const TEST = join(REPO, "scripts", "test-check-release-advisories.mjs");
const original = readFileSync(SRC, "utf8");

const MUTATIONS = [
  { name: "prod findings never block", find: "(n <= allowed ? acknowledged : blocking)", replace: "acknowledged" },
  { name: "acknowledgement is unbounded", find: "n <= allowed", replace: "n >= 0" },
  { name: "acknowledgement needs no reason", find: "typeof ack[name].reason === \"string\" && ack[name].reason.trim()", replace: "true" },
  { name: "could-not-check reads as clean", find: "errors.length ? \"error\" : ", replace: "" },
  { name: "empty result reads as clean", find: "Object.keys(packages).length === 0", replace: "false" },
  { name: "a critical OSV finding is ignored", find: "if (!BLOCKING.includes(f.severity)) continue;", replace: "continue;" },
  { name: "an audit failure is mistaken for a freshness failure", find: "&& !/^pnpm outdated[^·]*$/.test(row.error ?? \"\")", replace: "&& false" },
  { name: "peer findings block", find: "warnings.push(", replace: "blocking.push(" },
  { name: "the CLI always exits 0", find: "process.exit(r.status === \"clean\" ? 0 : 1)", replace: "process.exit(0)" },
];

const dir = mkdtempSync(join(tmpdir(), "reladv-mut-"));

// A copy must see the same world the real script sees: the repo's files are
// symlinked in (read-only use), siblings the script imports are copied beside it.
// WITHOUT THIS a mutant can be «killed» by an import error or a missing file,
// which reads as a pass and proves nothing — so a baseline of the UNMUTATED copy
// must be green before any mutant counts.
function sandbox(label, mutated) {
  const root = join(dir, label);
  const scripts = join(root, "scripts");
  execFileSync("mkdir", ["-p", scripts]);
  for (const f of ["dependency-health.mjs"]) if (existsSync(join(REPO, "scripts", f))) copyFileSync(join(REPO, "scripts", f), join(scripts, f));
  for (const e of [".github", "pnpm-workspace.yaml", "pnpm-lock.yaml", "packages", "node_modules", "package.json"]) if (existsSync(join(REPO, e))) symlinkSync(join(REPO, e), join(root, e));
  writeFileSync(join(scripts, SRC.split("/").pop()), mutated);
  copyFileSync(TEST, join(scripts, TEST.split("/").pop()));
  return { root, test: join(scripts, TEST.split("/").pop()) };
}
const passes = (sb) => { try { execFileSync("node", [sb.test], { cwd: sb.root, stdio: "pipe" }); return true; } catch { return false; } };
const base = sandbox("baseline", original);
if (!passes(base)) { console.error("  ✗ the UNMUTATED copy fails its own test — the harness would prove nothing"); process.exit(2); }
let survived = 0;
for (const m of MUTATIONS) {
  if (!original.includes(m.find)) { console.error(`  ✗ ANCHOR MISSING: ${m.name}`); process.exit(2); }
  const sb = sandbox(m.name.replace(/\W+/g, "_").slice(0, 40), original.replace(m.find, m.replace));
  const killed = !passes(sb);
  console.log(`  ${killed ? "✓ killed " : "✗ SURVIVED"}  ${m.name}`);
  if (!killed) survived++;
}
console.log(`\n${MUTATIONS.length - survived}/${MUTATIONS.length} mutants killed`);
process.exit(survived ? 1 : 0);

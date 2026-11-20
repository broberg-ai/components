#!/usr/bin/env node
// F115.6 — mutation pass for the Action pin gate. Mutants are applied to a
// COPY; the real gate is never written. Every mutation asserts its anchor applied.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const SRC = join(REPO, "scripts", "check-actions-pinned.mjs");
const TEST = join(REPO, "scripts", "test-check-actions-pinned.mjs");
const original = readFileSync(SRC, "utf8");

const MUTATIONS = [
  { name: "a tag counts as pinned", find: "if (SHA.test(ref)) return;", replace: "return;" },
  { name: "a branch ref counts as an own release tag", find: "!BRANCHES.has(ref)) return;", replace: "true) return;" },
  { name: "a ref-less uses is skipped", find: "if (at < 0) return void bad.push", replace: "if (at < 0) return void [].push" },
  { name: "a local ./ workflow is no longer exempt", find: "if (uses.startsWith(\"./\")) return;", replace: "" },
  { name: "an empty workflow dir reads as clean", find: "if (files.length === 0) {", replace: "if (false) {" },
  { name: "the CLI always exits 0", find: "process.exit(bad ? 1 : 0)", replace: "process.exit(0)" },
];

const dir = mkdtempSync(join(tmpdir(), "pin-mut-"));

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

#!/usr/bin/env node
// F115.2 — mutation pass for the CodeQL alert gate. Mutants are applied to a
// COPY; the real gate is never written. Every mutation asserts its anchor applied.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const SRC = join(REPO, "scripts", "check-codeql-alerts.mjs");
const TEST = join(REPO, "scripts", "test-check-codeql-alerts.mjs");
const original = readFileSync(SRC, "utf8");

const MUTATIONS = [
  { name: "high is not blocking", find: "new Set([\"critical\", \"high\"])", replace: "new Set([\"critical\"])" },
  { name: "critical is not blocking", find: "new Set([\"critical\", \"high\"])", replace: "new Set([\"high\"])" },
  { name: "dismissed alerts still block", find: "a.state === \"open\"", replace: "true" },
  { name: "an API error body reads as clean", find: "if (!Array.isArray(alerts)) return", replace: "if (false) return" },
  { name: "the CLI always exits 0", find: "process.exit(r.status === \"clean\" ? 0 : 1)", replace: "process.exit(0)" },
];

const dir = mkdtempSync(join(tmpdir(), "cql-mut-"));

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

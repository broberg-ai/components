#!/usr/bin/env node
// F115.5 — mutation pass for the pnpm hardening check. Mutants are applied to a
// COPY; the real gate is never written. Every mutation asserts its anchor applied.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const SRC = join(REPO, "scripts", "check-pnpm-hardening.mjs");
const TEST = join(REPO, "scripts", "test-check-pnpm-hardening.mjs");
const original = readFileSync(SRC, "utf8");

const MUTATIONS = [
  { name: "a missing allowlist is accepted", find: "if (!only) out.push(", replace: "if (false) out.push(" },
  { name: "an allowlist entry needs no reason", find: "if (!/\\s#\\s*\\S/.test(l))", replace: "if (false)" },
  { name: "the age floor is gone", find: "export const MIN_AGE = 1440;", replace: "export const MIN_AGE = 0;" },
  { name: "any package may be excluded from the age rule", find: "if (v !== \"@broberg/*\")", replace: "if (false)" },
  { name: "blockExoticSubdeps is not required", find: "if (!/^blockExoticSubdeps", replace: "if (false && !/^blockExoticSubdeps" },
  { name: "the CLI always exits 0", find: "process.exit(p.length ? 1 : 0)", replace: "process.exit(0)" },
];

const dir = mkdtempSync(join(tmpdir(), "pnpmh-mut-"));

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

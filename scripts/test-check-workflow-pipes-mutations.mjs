#!/usr/bin/env node
// F427.1 — mutation pass for the workflow pipe guard. Mutants are applied to a
// COPY; the real gate is never written. Every mutation asserts its anchor applied.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const SRC = join(REPO, "scripts", "check-workflow-pipes.mjs");
const PIPES = join(REPO, "scripts", "security-gate", "pipes.mjs");
const TEST = join(REPO, "scripts", "test-check-workflow-pipes.mjs");
const original = readFileSync(SRC, "utf8");

const MUTATIONS = [
  { file: "security-gate/pipes.mjs", name: "a pipe into tee is no longer looked for", find: "const PIPE_TO_TEE = /\\|\\s*tee\\b/;", replace: "const PIPE_TO_TEE = /^\\b$/;" },
  { file: "security-gate/pipes.mjs", name: "shell: bash on the step is not honoured", find: "const shell = String(s.shell ?? jobShell);", replace: "const shell = String(\"\");" },
  { file: "security-gate/pipes.mjs", name: "defaults.run.shell on the workflow is not honoured", find: "const wfShell = String(wf?.defaults?.run?.shell ?? \"\");", replace: "const wfShell = \"\";" },
  { file: "security-gate/pipes.mjs", name: "defaults.run.shell on the job is not honoured", find: "String(j?.defaults?.run?.shell ?? wfShell)", replace: "String(wfShell)" },
  { file: "security-gate/pipes.mjs", name: "any shell counts as safe (sh too)", find: "/^bash\\b/.test(shell)", replace: "shell !== \"\"" },
  { file: "security-gate/pipes.mjs", name: "a reasonless pipe-ok counts (newline eaten)", find: "/#[ \\t]*pipe-ok:[ \\t]*\\S/.test(run)", replace: "/#\\s*pipe-ok:\\s*\\S/.test(run)" },
  { file: "security-gate/pipes.mjs", name: "pipefail is no longer recognised", find: "/set\\s+-[a-z]*o\\s+pipefail/.test(run) ||", replace: "false ||" },
  { name: "an empty workflow dir reads as clean", find: "if (files.length === 0) {", replace: "if (false) {" },
  { name: "the CLI always exits 0", find: "process.exit(bad ? 1 : 0)", replace: "process.exit(0)" },
];

const dir = mkdtempSync(join(tmpdir(), "pipes-mut-"));

// A copy must see the same world the real script sees: the repo's files are
// symlinked in (read-only use), siblings the script imports are copied beside it.
// WITHOUT THIS a mutant can be «killed» by an import error or a missing file,
// which reads as a pass and proves nothing — so a baseline of the UNMUTATED copy
// must be green before any mutant counts.
function sandbox(label, file, mutated) {
  const root = join(dir, label);
  const scripts = join(root, "scripts");
  execFileSync("mkdir", ["-p", scripts]);
  for (const f of ["dependency-health.mjs"]) if (existsSync(join(REPO, "scripts", f))) copyFileSync(join(REPO, "scripts", f), join(scripts, f));
  for (const e of [".github", "pnpm-workspace.yaml", "pnpm-lock.yaml", "packages", "node_modules", "package.json"]) if (existsSync(join(REPO, e))) symlinkSync(join(REPO, e), join(root, e));
  execFileSync("mkdir", ["-p", join(scripts, "security-gate")]);
  copyFileSync(SRC, join(scripts, "check-workflow-pipes.mjs"));
  copyFileSync(PIPES, join(scripts, "security-gate", "pipes.mjs"));
  if (file === "check-workflow-pipes.mjs") writeFileSync(join(scripts, file), mutated);
  else if (file === "security-gate/pipes.mjs") writeFileSync(join(scripts, file), mutated);
  copyFileSync(TEST, join(scripts, TEST.split("/").pop()));
  return { root, test: join(scripts, TEST.split("/").pop()) };
}
const passes = (sb) => { try { execFileSync("node", [sb.test], { cwd: sb.root, stdio: "pipe" }); return true; } catch { return false; } };
const SOURCES = { "check-workflow-pipes.mjs": readFileSync(SRC, "utf8"), "security-gate/pipes.mjs": readFileSync(PIPES, "utf8") };
const base = sandbox("baseline", null, null);
if (!passes(base)) { console.error("  ✗ the UNMUTATED copy fails its own test — the harness would prove nothing"); process.exit(2); }
let survived = 0;
for (const m of MUTATIONS) {
  const file = m.file ?? "check-workflow-pipes.mjs";
  const text = SOURCES[file];
  if (!text.includes(m.find)) { console.error(`  ✗ ANCHOR MISSING in ${file}: ${m.name}`); process.exit(2); }
  const sb = sandbox(m.name.replace(/\W+/g, "_").slice(0, 40), file, text.replace(m.find, m.replace));
  const killed = !passes(sb);
  console.log(`  ${killed ? "✓ killed " : "✗ SURVIVED"}  ${m.name}`);
  if (!killed) survived++;
}
console.log(`\n${MUTATIONS.length - survived}/${MUTATIONS.length} mutants killed`);
process.exit(survived ? 1 : 0);

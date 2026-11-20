#!/usr/bin/env node
// F427.1 — mutation pass for the fleet security gate's decisions and lockfile readers.
//
// Each mutation is applied to a COPY of scripts/security-gate/ (the real files are never written, so an interrupted
// run cannot leave a mutant on disk) and the unit tests must go red. An UNMUTATED copy must be green first — without
// that baseline a mutant «killed» by a missing import reads exactly like a real catch and proves nothing.
// Every mutation asserts its ANCHOR applied: a substitution that matched nothing reads like a surviving mutant.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, mkdirSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const dir = mkdtempSync(join(tmpdir(), "gate-mut-"));

const MUTATIONS = [
  // --- acks: the rules that stop an exemption from becoming permanent
  { file: "decide.mjs", name: "an expired ack still counts", find: "if (left < 0) {", replace: "if (false) {" },
  { file: "decide.mjs", name: "an ack may expire any distance away", find: "if (left > MAX_ACK_DAYS) {", replace: "if (false) {" },
  { file: "decide.mjs", name: "an ack needs no real reason", find: "a.reason.trim().length < MIN_REASON", replace: "false" },
  { file: "decide.mjs", name: "an ack needs no expiry date", find: "if (!isIsoDate(a.expires)) {", replace: "if (false) {" },
  { file: "decide.mjs", name: "an ack with a path covers every path", find: "(a.path === undefined || a.path === finding.path)", replace: "true" },
  { file: "decide.mjs", name: "an ack no longer matches aliases (CVE ids)", find: "(finding.ids ?? [finding.id])", replace: "[finding.id]" },
  // --- what blocks
  { file: "decide.mjs", name: "HIGH no longer blocks", find: 'new Set(["high", "critical"])', replace: 'new Set(["critical"])' },
  { file: "decide.mjs", name: "findings only in build/test tooling block too", find: "f.shipped && BLOCKING_SEVERITY.has(f.severity)", replace: "BLOCKING_SEVERITY.has(f.severity)" },
  { file: "decide.mjs", name: "a malicious package is only judged when shipped", find: "deps.findings.filter((f) => f.malicious).map(asFinding)", replace: "deps.findings.filter((f) => f.malicious && f.shipped).map(asFinding)" },
  { file: "decide.mjs", name: "GitHub's malware wording is not recognised", find: "/^(malicious package|malware) in\\b/i.test(", replace: "/^$/.test(" },
  { file: "decide.mjs", name: "a MAL- id is not recognised", find: 'String(v?.id ?? "").startsWith("MAL-")', replace: "false" },
  { file: "decide.mjs", name: "only Semgrep ERROR blocks → WARNING blocks too", find: '.filter((r) => String(r.extra?.severity ?? "").toUpperCase() === "ERROR")\n    .map(', replace: '.filter((r) => ["ERROR","WARNING"].includes(String(r.extra?.severity ?? "").toUpperCase()))\n    .map(' },
  { file: "decide.mjs", name: "zizmor Medium blocks too (or High stops blocking)", find: "BLOCKING_SEVERITY.has(sev(z))).map((z)", replace: 'sev(z) !== "informational").map((z)' },
  { file: "decide.mjs", name: "pipe findings are dropped from the workflows check", find: "...pipes];", replace: "];" },
  { file: "decide.mjs", name: "unreadable workflow files read as clean", find: 'if (!Array.isArray(pipes)) return errored("workflows"', replace: 'if (!Array.isArray(pipes)) return verdict("workflows", [], acks); void (0, errored("workflows"' },
  { file: "run-check.mjs", name: "the pipe check is not wired into the workflows check", find: "decideWorkflows(runZizmor(dir), acks, await runPipes(dir))", replace: "decideWorkflows(runZizmor(dir), acks, [])" },
  // --- could-not-check must be RED, never green
  { file: "decide.mjs", name: "an OSV failure reads as green", find: "if (!deps || (deps.errors ?? []).length) {", replace: "if (!deps) {" },
  { file: "decide.mjs", name: "no Semgrep result reads as green", find: 'if (!semgrep || !Array.isArray(semgrep.results)) return errored("sast"', replace: 'if (!semgrep || !Array.isArray(semgrep.results)) return verdict("sast", [], acks); void (0, errored("sast"' },
  { file: "decide.mjs", name: "no zizmor result reads as green", find: 'if (!Array.isArray(zizmor)) return errored("workflows"', replace: 'if (!Array.isArray(zizmor)) return verdict("workflows", [], acks); void (0, errored("workflows"' },
  { file: "decide.mjs", name: "a missing lockfile no longer blocks", find: "if (!p.lockfile) findings.push(", replace: "if (false) findings.push(" },
  { file: "decide.mjs", name: "a failed frozen install no longer blocks", find: 'else if (p.frozen === "failed")', replace: "else if (false)" },
  { file: "decide.mjs", name: "overall: an error no longer outranks green", find: 'states.includes("error") ? "error" : ', replace: "" },
  { file: "decide.mjs", name: "the refused ack is not shown", find: "for (const r of rejectedAcks) lines.push(", replace: "for (const r of []) lines.push(" },
  { file: "decide.mjs", name: "a blocking line does not name its check", find: "::error::[${v.name}] ${f.id}", replace: "::error::${f.id}" },
  // --- lockfiles: what «ships» means
  { file: "lockfiles.mjs", name: "npm: a peer-only package counts as shipped", find: "&& !p.peer)", replace: ")" },
  { file: "lockfiles.mjs", name: "npm: a dev package counts as shipped", find: "if (!p.dev && !p.devOptional", replace: "if (true" },
  { file: "lockfiles.mjs", name: "pnpm: an auto-installed peer counts as shipped", find: "(declaredProd === null || declaredProd.has(n))", replace: "true" },
  { file: "lockfiles.mjs", name: "pnpm: a skipped importer is still judged", find: "if (skipped(dir, skipImporters)) continue;\n    // pnpm's", replace: "// pnpm's" },
  { file: "lockfiles.mjs", name: "pnpm: devDependencies are not in the full tree", find: '["dev", imp.devDependencies]', replace: '["dev", {}]' },
  { file: "lockfiles.mjs", name: "bun: devDependencies count as shipped", find: "for (const d of Object.keys({ ...(w.dependencies ?? {}), ...(w.optionalDependencies ?? {}) })) { const r = resolve(\"\", d); if (r) walk(shipped", replace: "for (const d of Object.keys({ ...(w.dependencies ?? {}), ...(w.devDependencies ?? {}) })) { const r = resolve(\"\", d); if (r) walk(shipped" },
  { file: "lockfiles.mjs", name: "bun: a nested version is not resolved (picks the top-level one)", find: "const k = scope ? `${scope}/${dep}` : dep;", replace: "const k = dep;" },
  { file: "lockfiles.mjs", name: "JSONC: comments are not stripped", find: 'if (c === "/" && text[i + 1] === "/") {', replace: "if (false) {" },
  { file: "lockfiles.mjs", name: "unsupported lockfiles are silently skipped", find: "else if (UNSUPPORTED.includes(name))", replace: "else if (false)" },
  { file: "lockfiles.mjs", name: "node_modules is scanned", find: 'const SKIP_DIRS = new Set(["node_modules", ".git", ".claude",', replace: 'const SKIP_DIRS = new Set([".git", ".claude",' },
  // --- the tools: «it printed nothing» is not «it found nothing»
  { file: "run-check.mjs", name: "zizmor with no output reads as zero findings", find: "if (r.error || !r.stdout.trim()) return null;", replace: 'if (r.error) return null; if (!r.stdout.trim()) return [];' },
  { file: "run-check.mjs", name: "a Semgrep crash reads as zero findings", find: "catch { return null; } // null = it did not produce a result", replace: "catch { return { results: [], errors: [] }; } // mutant" },
];

function sandbox(label, mutate) {
  const root = join(dir, label);
  const scripts = join(root, "scripts");
  mkdirSync(scripts, { recursive: true });
  cpSync(join(REPO, "scripts", "security-gate"), join(scripts, "security-gate"), { recursive: true });
  cpSync(join(REPO, "scripts", "dependency-health.mjs"), join(scripts, "dependency-health.mjs"));
  cpSync(join(REPO, "scripts", "test-security-gate.mjs"), join(scripts, "test-security-gate.mjs"));
  for (const e of ["node_modules", "package.json"]) if (existsSync(join(REPO, e))) symlinkSync(join(REPO, e), join(root, e));
  if (mutate) { const f = join(scripts, "security-gate", mutate.file); writeFileSync(f, readFileSync(f, "utf8").replace(mutate.find, mutate.replace)); }
  return { root, test: join(scripts, "test-security-gate.mjs") };
}
const passes = (sb) => { try { execFileSync("node", [sb.test], { cwd: sb.root, stdio: "pipe" }); return true; } catch { return false; } };

const base = sandbox("baseline");
if (!passes(base)) { console.error("  ✗ the UNMUTATED copy fails its own tests — the harness would prove nothing"); process.exit(2); }

let survived = 0;
MUTATIONS.forEach((m, i) => {
  const original = readFileSync(join(REPO, "scripts", "security-gate", m.file), "utf8");
  if (!original.includes(m.find)) { console.error(`  ✗ ANCHOR MISSING: ${m.name}`); process.exit(2); }
  const killed = !passes(sandbox(`m${i}`, m));
  console.log(`  ${killed ? "✓ killed  " : "✗ SURVIVED"}  ${m.name}`);
  if (!killed) survived++;
});
console.log(`\n${MUTATIONS.length - survived}/${MUTATIONS.length} mutants killed`);
process.exit(survived ? 1 : 0);

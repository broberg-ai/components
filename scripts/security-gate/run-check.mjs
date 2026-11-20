#!/usr/bin/env node
// F427.1 — run one (or all) of the fleet security checks on a directory and decide.
//
//   node scripts/security-gate/run-check.mjs <deps|sast|workflows|install|all> [--dir .] [--ack .github/security-ack.json]
//        [--exclude a/,b/] [--skip-importers examples/] [--sast-exclude x/,y/] [--today YYYY-MM-DD] [--out result.json]
//
// The reusable workflow's jobs call this, and so does the selftest — so the selftest exercises the real path, not
// a copy of it. Exit: 0 every requested check green · 1 any check red or could-not-check · 2 bad usage.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { measureDeps } from "./deps.mjs";
import { SUPPORTED } from "./lockfiles.mjs";
import { decideDeps, decideSast, decideWorkflows, decideInstall, validateAcks, overall, render } from "./decide.mjs";

// ONE source for the rule packs — change a pack here and every repo in the fleet follows at the next engine tag.
export const RULE_PACKS = ["p/security-audit", "p/owasp-top-ten", "p/javascript", "p/typescript", "p/nodejs"];
const ALWAYS_EXCLUDE = ["node_modules", ".git", "dist", "build", ".next", ".turbo", ".claude", "coverage"];

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

function runTool(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 256e6, ...opts });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

// ------------------------------------------------------------------ sast
export function runSemgrep(dir, extraExclude) {
  const bin = process.env.SEMGREP_BIN ?? "semgrep";
  const args = ["scan", "--json", "--metrics=off", "--quiet", "--disable-version-check", "--timeout", "30"];
  for (const p of RULE_PACKS) args.push("--config", p);
  for (const e of [...ALWAYS_EXCLUDE, ...extraExclude]) args.push("--exclude", e);
  args.push(dir);
  const r = runTool(bin, args);
  try { return JSON.parse(r.stdout); } catch { return null; } // null = it did not produce a result = «could not check»
}

// ------------------------------------------------------------------ workflows
export function runZizmor(dir) {
  const bin = process.env.ZIZMOR_BIN ?? "zizmor";
  const wf = join(dir, ".github", "workflows");
  if (!existsSync(wf)) return []; // no workflows → nothing to harden (a fact, not a failure)
  // With a token zizmor also asks GitHub (known-vulnerable actions, impostor commits); without one it stays offline.
  // An EMPTY token variable is worse than none (zizmor tries to use it), so it is removed, not passed on.
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  const env = { ...process.env };
  delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
  if (token) env.GH_TOKEN = token;
  const args = ["--format", "json", "--no-progress", ...(token ? [] : ["--offline"]), wf];
  const r = runTool(bin, args, { env });
  // zizmor prints `[]` when it found nothing. NO stdout at all means it did not run — that is «could not check»,
  // never «clean» (the selftest caught this: an empty answer was read as an empty finding list).
  if (r.error || !r.stdout.trim()) return null;
  try { const j = JSON.parse(r.stdout); return Array.isArray(j) ? j : null; } catch { return null; }
}

// ------------------------------------------------------------------ install
function packageJsonDirs(root, exclude) {
  const out = [];
  const ex = exclude.map((e) => e.replace(/\/+$/, ""));
  const skip = new Set(ALWAYS_EXCLUDE);
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (skip.has(name)) continue;
      const abs = join(d, name);
      const rel = relative(root, abs).split(sep).join("/");
      if (ex.some((e) => rel === e || rel.startsWith(e + "/"))) continue;
      let st; try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) walk(abs);
      else if (name === "package.json") out.push(relative(root, d).split(sep).join("/"));
    }
  };
  walk(root);
  return out;
}

const FROZEN = {
  pnpm: { lock: "pnpm-lock.yaml", bin: "pnpm", args: ["install", "--frozen-lockfile", "--lockfile-only", "--ignore-scripts"] },
  bun: { lock: "bun.lock", bin: "bun", args: ["install", "--frozen-lockfile", "--ignore-scripts", "--dry-run"] },
  npm: { lock: "package-lock.json", bin: "npm", args: ["ci", "--dry-run", "--ignore-scripts"] },
};

/** The lines of a failed install that say WHY (not the «complete log is at …» boilerplate). */
const errorLines = (text) => text.split("\n").filter((l) => /err|frozen|lockfile|sync|outdated/i.test(l) && !/complete log|debug-0|\.log$/i.test(l)).slice(0, 2).join(" | ").trim() || text.trim().split("\n").slice(-1)[0];

export function runInstallCheck(root, exclude) {
  const dirs = packageJsonDirs(root, exclude).sort();
  const hasLock = (d) => Object.values(FROZEN).some((m) => existsSync(join(root, d, m.lock)));
  // A project = a directory with its own lockfile, or the topmost package.json (workspace members share the root's lock).
  const isAncestor = (o, d) => o !== d && (o === "" || d.startsWith(o + "/"));
  const projects = dirs.filter((d) => hasLock(d) || !dirs.some((o) => isAncestor(o, d)));
  const result = [];
  for (const d of projects) {
    const manager = Object.keys(FROZEN).find((k) => existsSync(join(root, d, FROZEN[k].lock)));
    if (!manager) { result.push({ dir: d, manager: null, lockfile: false, frozen: "skipped" }); continue; }
    const m = FROZEN[manager];
    const r = runTool(m.bin, m.args, { cwd: join(root, d) });
    const ok = r.status === 0 && !r.error;
    result.push({ dir: d, manager, lockfile: true, frozen: ok ? "ok" : "failed", detail: ok ? "" : (r.error ? `${m.bin} not runnable: ${r.error.code}` : errorLines(`${r.stderr}\n${r.stdout}`)) });
  }
  return { projects: result };
}

// ------------------------------------------------------------------ main
async function main() {
  const which = process.argv[2];
  const valid = ["deps", "sast", "workflows", "install", "all"];
  if (!valid.includes(which)) { console.error(`usage: run-check.mjs <${valid.join("|")}> [--dir .] [--ack file] …`); process.exit(2); }
  const dir = arg("dir", ".");
  const ackPath = arg("ack", join(dir, ".github", "security-ack.json"));
  const exclude = list(arg("exclude", "security-gate/fixtures/"));
  const today = arg("today", new Date().toISOString().slice(0, 10));
  let ackRaw;
  if (existsSync(ackPath)) {
    try { ackRaw = JSON.parse(readFileSync(ackPath, "utf8")); } catch (e) { console.log(`::error::[ack] ${ackPath} is not JSON: ${e.message}`); process.exit(1); }
  }
  const { valid: acks, rejected } = validateAcks(ackRaw, today);
  const verdicts = [];
  const want = (n) => which === "all" || which === n;
  if (want("deps")) {
    const { parse } = await import("yaml");
    verdicts.push(...decideDeps(await measureDeps(dir, { exclude, skipImporters: list(arg("skip-importers")), yamlParse: parse }), acks));
  }
  if (want("sast")) verdicts.push(decideSast(runSemgrep(dir, [...exclude, ...list(arg("sast-exclude"))]), acks));
  if (want("workflows")) verdicts.push(decideWorkflows(runZizmor(dir), acks));
  if (want("install")) verdicts.push(decideInstall(runInstallCheck(dir, exclude), acks));
  const text = render(verdicts, rejected);
  console.log(text);
  const out = arg("out");
  if (out) writeFileSync(out, JSON.stringify({ overall: overall(verdicts), verdicts, rejectedAcks: rejected, today }, null, 2));
  process.exit(overall(verdicts) === "green" ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

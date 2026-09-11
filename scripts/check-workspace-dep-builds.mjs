#!/usr/bin/env node
// F080.4 — a package that reads a workspace sibling's types must have that
// sibling BUILT before its publish job typechecks it.
//
// Three publishes failed on `TS2307: Cannot find module '@broberg/apikey'`
// while every local run was green. The cause I found was real — turbo.json gave
// `typecheck` no `dependsOn`, so nothing built the sibling — and fixing it made
// the WORKSPACE GATE green on main for the first time that day.
//
// The publish failed again anyway, on the same line, because publish.yml never
// calls turbo:
//
//     - name: Typecheck
//       working-directory: packages/secret-scan
//       run: pnpm typecheck            # -> the PACKAGE's script: `tsc --noEmit`
//
// `working-directory` runs the package's own script. The task graph is never
// consulted. Two mechanisms, one of them fixed — a guard shaped by the report
// closing only the half that was named.
//
// TODAY THIS IS ONE PACKAGE. Measured, not assumed: exactly one of 40 declares a
// `workspace:` dependency (@broberg/secret-scan -> @broberg/apikey). That is the
// reason for a check rather than only a patch — the SECOND package to grow one
// gets no warning, and finds out when a release goes red.
//
// BOTH SIDES ARE DERIVED, neither is a list. The packages come from
// packages/*/package.json, the jobs from parsing publish.yml. A hand-written
// list of "packages that need this" is the thing that goes stale in silence,
// which is the failure being sealed.
//
//   node scripts/check-workspace-dep-builds.mjs
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// `yaml` is a root devDependency. If it is missing this guard has not FAILED, it
// has not RUN — and those must not share an exit code. A caller that reads
// "could not check" as "checked and clean" is this repo's most-repeated defect.
let yaml;
try {
  yaml = (await import("yaml")).default;
} catch {
  console.error("cannot check: the `yaml` package is not installed (run `pnpm install`)");
  process.exit(2);
}

const ROOT = new URL("../", import.meta.url).pathname;
const PKG_DIR = join(ROOT, "packages");
const WORKFLOW = join(ROOT, ".github/workflows/publish.yml");

/** Every local package that depends on another package in this workspace. */
function packagesWithWorkspaceDeps() {
  const out = [];
  for (const dir of readdirSync(PKG_DIR).sort()) {
    const manifest = join(PKG_DIR, dir, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    const deps = Object.entries(all)
      .filter(([, range]) => String(range).startsWith("workspace:"))
      .map(([name]) => name);
    if (deps.length) out.push({ name: pkg.name, dir, deps });
  }
  return out;
}

/**
 * The jobs in publish.yml, as { jobName -> the concatenated text of its steps }.
 * Step NAMES are included on purpose: the fix is as likely to be written as a
 * differently-named step as with this exact command, and what must be true is
 * that a build of the dependencies happens before the typecheck.
 */
function publishJobs() {
  const doc = yaml.parse(readFileSync(WORKFLOW, "utf8"));
  const jobs = new Map();
  for (const [name, job] of Object.entries(doc?.jobs ?? {})) {
    const steps = (job?.steps ?? []).map((s) => `${s?.name ?? ""}\n${typeof s?.run === "string" ? s.run : ""}`);
    jobs.set(name, steps);
  }
  return jobs;
}

/**
 * Does this job build the package's workspace dependencies BEFORE typechecking?
 *
 * "Before" is load-bearing and is why this reads step ORDER rather than merely
 * asking whether the text appears anywhere: a build after the typecheck is a
 * build that did not help.
 */
function buildsDepsBeforeTypecheck(steps, pkgName) {
  const escaped = pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const buildsDeps = new RegExp(`turbo\\s+run\\s+build[^\\n]*--filter=["']?${escaped}\\^`);
  const typechecks = /\bpnpm\s+typecheck\b|turbo\s+run\s+typecheck\b/;

  const buildAt = steps.findIndex((s) => buildsDeps.test(s));
  const typecheckAt = steps.findIndex((s) => typechecks.test(s));
  if (typecheckAt === -1) return { ok: true, why: "this job does not typecheck" };
  if (buildAt === -1) return { ok: false, why: "no step builds its workspace dependencies" };
  if (buildAt > typecheckAt) return { ok: false, why: "the dependency build runs AFTER the typecheck, which is too late" };
  return { ok: true, why: `step ${buildAt + 1} builds them, step ${typecheckAt + 1} typechecks` };
}

const jobs = publishJobs();
const subjects = packagesWithWorkspaceDeps();
let failures = 0;

const allPackages = readdirSync(PKG_DIR).filter((d) => existsSync(join(PKG_DIR, d, "package.json")));

// A READER THAT FOUND NOTHING IS NOT A CLEAN REPO, and until now only the
// message said so while the exit code said "fine". `&&` in `pnpm test` reads the
// exit code, so the distinction was invisible to the one caller that matters.
// Zero packages WITH a workspace: dep is a legitimate state (it was this repo
// until recently) — zero packages AT ALL is this script failing to read.
if (!allPackages.length) {
  console.error("cannot check: found no package.json under packages/ — this check did not run");
  process.exit(2);
}

if (!subjects.length) {
  // Legitimate, and now provably distinct from the line above: we read N
  // packages and none of them declares one.
  console.log(
    `no package in packages/ declares a \`workspace:\` dependency — nothing for this check to hold (${allPackages.length} read)`,
  );
}

for (const { name, dir, deps } of subjects) {
  // The publish job for a package is named publish-<dir>; if the convention ever
  // changes this must SAY so rather than quietly find nothing to check.
  const jobName = `publish-${dir}`;
  const steps = jobs.get(jobName);
  if (!steps) {
    console.log(`  ✗ ${name}\n      depends on ${deps.join(", ")} but there is no job \`${jobName}\` in publish.yml`);
    failures++;
    continue;
  }
  const verdict = buildsDepsBeforeTypecheck(steps, name);
  if (verdict.ok) {
    console.log(`  ✓ ${name}  (${deps.join(", ")}) — ${verdict.why}`);
    continue;
  }
  console.log(
    `  ✗ ${name}\n      depends on ${deps.join(", ")} via workspace:, and job \`${jobName}\` ${verdict.why}.` +
      `\n      \`working-directory\` makes pnpm run the PACKAGE's own script, so turbo — and the` +
      `\n      \`^build\` in turbo.json — is never consulted. Add before the Typecheck step:` +
      `\n\n        - name: Build workspace dependencies` +
      `\n          run: pnpm turbo run build --filter="${name}^..."\n`,
  );
  failures++;
}

// The 39 packages with no workspace: dependency are deliberately NOT required to
// have the step. Without that half this rule would redden every correct job on
// the day it shipped, and a gate switched off on day one still looks like
// coverage. Printed so the number is visible rather than assumed.
const untouched = allPackages.length - subjects.length;
console.log(
  failures
    ? `\n${failures} package(s) can typecheck against a sibling that was never built`
    : `\nevery package with a workspace: dependency builds it first (${subjects.length} checked, ${untouched} with none, not required to)`,
);
process.exit(failures ? 1 : 0);

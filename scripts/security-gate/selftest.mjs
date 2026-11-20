#!/usr/bin/env node
// F427.1 — the gate proves it can FAIL. A gate that cannot find anything must not be allowed to report a repo clean
// (cms F201.16: gitleaks ran for six months with a config that replaced its rules with none, and said «no leaks»).
//
//   node scripts/security-gate/selftest.mjs
//
// For every blocking check there is a fixture with ONE planted finding; the REAL run-check.mjs — the same code path
// the reusable workflow runs, with the real tools — must go red and name that check. The clean fixture must be green.
// Then the ack rules, end to end: a valid ack silences exactly its id, an expired one does not.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const RUN = join(HERE, "run-check.mjs");
const FIX = join(ROOT, "security-gate", "fixtures");
const only = process.argv[2]; // optional: run one case by its name

const run = (check, dir, extra = []) => {
  const r = spawnSync("node", [RUN, check, "--dir", dir, "--exclude", "", ...extra], { encoding: "utf8", cwd: ROOT, maxBuffer: 64e6 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const withAck = (acks) => {
  const d = mkdtempSync(join(tmpdir(), "gate-ack-"));
  const f = join(d, "security-ack.json");
  writeFileSync(f, JSON.stringify({ acks }));
  return f;
};
const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const past = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

// name, run → expectation. `red` cases name the check that must appear as `::error::[<check>]`.
const CASES = [
  { name: "clean fixture is green on every check", go: () => run("all", join(FIX, "clean")), green: true },
  { name: "deps-vuln: a shipped HIGH dependency goes red", go: () => run("deps", join(FIX, "vuln-dep")), red: "deps-vuln" },
  { name: "deps-malicious: a malicious package goes red", go: () => run("deps", join(FIX, "mal-dep")), red: "deps-malicious" },
  { name: "sast: a Semgrep ERROR goes red", go: () => run("sast", join(FIX, "sast-error")), red: "sast" },
  { name: "workflows: a zizmor High goes red", go: () => run("workflows", join(FIX, "workflow-high")), red: "workflows" },
  { name: "workflows: a gate piped into tee without pipefail goes red", go: () => run("workflows", join(FIX, "workflow-pipe")), red: "workflows", also: /pipe-swallows-failure/ },
  { name: "install: a drifted lockfile goes red", go: () => run("install", join(FIX, "lockfile-drift")), red: "install" },
  {
    name: "ack: a valid ack for every vulnerable id silences deps-vuln",
    go: () => {
      const first = run("deps", join(FIX, "vuln-dep"));
      const ids = [...first.out.matchAll(/\[deps-vuln\] (GHSA-[\w-]+)/g)].map((m) => m[1]);
      if (ids.length === 0) return { code: 1, out: "could not read the ids to acknowledge from:\n" + first.out };
      const ack = withAck(ids.map((id) => ({ id, reason: "selftest: planted dependency, never shipped", expires: future(30) })));
      return run("deps", join(FIX, "vuln-dep"), ["--ack", ack]);
    },
    green: true,
  },
  {
    name: "ack: the same acks, EXPIRED yesterday, silence nothing",
    go: () => {
      const first = run("deps", join(FIX, "vuln-dep"));
      const ids = [...first.out.matchAll(/\[deps-vuln\] (GHSA-[\w-]+)/g)].map((m) => m[1]);
      if (ids.length === 0) return { code: 1, out: "could not read the ids to acknowledge from:\n" + first.out };
      const ack = withAck(ids.map((id) => ({ id, reason: "selftest: planted dependency, never shipped", expires: past(1) })));
      return run("deps", join(FIX, "vuln-dep"), ["--ack", ack]);
    },
    red: "deps-vuln",
    also: /\[ack\] .* does not count: expired/,
  },
  {
    name: "ack: an ack for a DIFFERENT id silences nothing",
    go: () => run("deps", join(FIX, "vuln-dep"), ["--ack", withAck([{ id: "GHSA-0000-0000-0000", reason: "selftest: unrelated id", expires: future(30) }])]),
    red: "deps-vuln",
  },
  {
    name: "ack: a malicious package cannot be waved through by acking its vulnerability twin only",
    go: () => run("deps", join(FIX, "mal-dep"), ["--ack", withAck([{ id: "GHSA-mh6f-8j2x-4483", reason: "selftest: only the vulnerability record", expires: future(30) }])]),
    red: "deps-malicious",
  },
];

let failed = 0;
for (const c of CASES) {
  if (only && c.name !== only) continue;
  const r = c.go();
  const named = c.red ? new RegExp(`::error::\\[${c.red}\\]`).test(r.out) : null;
  let ok, why = "";
  if (c.green) { ok = r.code === 0; if (!ok) why = "expected green, got exit " + r.code; }
  else { ok = r.code === 1 && named; if (!ok) why = r.code !== 1 ? `expected red (exit 1), got exit ${r.code}` : `went red but not by the name [${c.red}]`; }
  if (ok && c.also && !c.also.test(r.out)) { ok = false; why = `output lacks ${c.also}`; }
  console.log(`  ${ok ? "✓" : "✗"} ${c.name}${ok ? "" : `  — ${why}`}`);
  if (!ok) { failed++; console.log(r.out.split("\n").slice(0, 25).map((l) => `      ${l}`).join("\n")); }
}
console.log(`\n${failed ? `${failed} FAILED` : "selftest green: every check went red by name, the clean fixture is green, the ack rules hold"}`);
process.exit(failed ? 1 : 0);

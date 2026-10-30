#!/usr/bin/env node
// F038.14 — prove a release the way a CONSUMER will get it, with the previous
// version as the negative control. cardmem asked for it: «vi skriver den forfra
// hver gang». The install is the easy part; the two properties below are what
// keep being rebuilt by hand and forgotten:
//
//   1. THE ROW SHOWS THE VERSION THAT ACTUALLY RESOLVED, read from the installed
//      package.json — never the version that was asked for. Measured 2026-09-03:
//      an install of a version that did not exist failed behind `--silent
//      >/dev/null`, a stale node_modules answered, and 0.3.2 was compared with
//      itself. Both columns said OK and the check proved nothing.
//   2. THE PREVIOUS VERSION IS THE CONTROL, printed side by side. Without it,
//      "the new version rejects X" can be a fact about a dependency, not our change.
//
//   node scripts/verify-release.mjs <pkg> <control-version> <new-version> <probe.mjs>
//
// Each version gets its OWN empty directory (no shared node_modules to answer for
// it). The probe runs there with VERIFY_PKG / VERIFY_VERSION set; its stdout and
// exit code are the data. Exit: 0 both installed + probes ran · 1 a version could
// not be installed or resolved to something else (named) · 2 bad usage.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";

export class ReleaseVerifyError extends Error {}

/** Default installer: real npm, output KEPT so a failure can be named. */
export function npmInstall(dir, spec) {
  const r = spawnSync("npm", ["install", spec, "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) {
    const why = `${r.stderr}\n${r.stdout}`.split("\n").map((l) => l.trim()).find((l) => /E404|ETARGET|No matching version|ERR!/.test(l)) ?? `npm exited ${r.status}`;
    throw new ReleaseVerifyError(`npm could not install ${spec}: ${why}`);
  }
}

/** Install one version into a fresh dir and run the probe there. */
export function runOne({ pkg, version, probe, install = npmInstall, base = tmpdir() }) {
  const dir = mkdtempSync(join(base, `verify-${basename(pkg)}-${version}-`));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "verify-release-probe", private: true, type: "module" }));
  install(dir, `${pkg}@${version}`);
  let resolved;
  try {
    resolved = JSON.parse(readFileSync(join(dir, "node_modules", ...pkg.split("/"), "package.json"), "utf8")).version;
  } catch {
    throw new ReleaseVerifyError(`${pkg}@${version}: the install reported success but node_modules/${pkg}/package.json is missing`);
  }
  if (resolved !== version) {
    throw new ReleaseVerifyError(`${pkg}: asked for ${version}, the install RESOLVED ${resolved} — refusing to compare a version with something else`);
  }
  const probeFile = join(dir, "probe.mjs");
  copyFileSync(probe, probeFile);
  const p = spawnSync(process.execPath, [probeFile], { cwd: dir, encoding: "utf8", env: { ...process.env, VERIFY_PKG: pkg, VERIFY_VERSION: version } });
  return { requested: version, resolved, dir, exit: p.status, out: (p.stdout + (p.stderr ? `\n[stderr] ${p.stderr.trim()}` : "")).trim() };
}

/** Both columns, side by side. Flags a control that did not discriminate. */
export function table(pkg, control, next) {
  const rows = [["", `control (${control.requested})`, `new (${next.requested})`], ["resolved", control.resolved, next.resolved], ["probe exit", String(control.exit), String(next.exit)]];
  const a = control.out.split("\n"), b = next.out.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) rows.push([i === 0 ? "probe out" : "", a[i] ?? "", b[i] ?? ""]);
  const w = [0, 1, 2].map((c) => Math.max(...rows.map((r) => r[c].length)));
  const line = (r) => r.map((cell, c) => cell.padEnd(w[c])).join("  │  ");
  const same = control.out === next.out && control.exit === next.exit;
  return [`${pkg}`, line(rows[0]), w.map((n) => "─".repeat(n)).join("──┼──"), ...rows.slice(1).map(line),
    "", same ? "⚠ SAME OUTPUT in both columns — the control did not discriminate; this run proves nothing about the change."
             : "✓ the columns differ — the control discriminated."].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [pkg, controlV, newV, probe] = process.argv.slice(2);
  if (!pkg || !controlV || !newV || !probe) {
    console.error("usage: verify-release.mjs <pkg> <control-version> <new-version> <probe.mjs>");
    process.exit(2);
  }
  try {
    const control = runOne({ pkg, version: controlV, probe: resolve(probe) });
    const next = runOne({ pkg, version: newV, probe: resolve(probe) });
    console.log(table(pkg, control, next));
  } catch (e) {
    if (!(e instanceof ReleaseVerifyError)) throw e;
    console.error(`\n  ✗ ${e.message}\n  Nothing was compared.\n`);
    process.exit(1);
  }
}

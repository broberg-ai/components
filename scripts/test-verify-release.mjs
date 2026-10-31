#!/usr/bin/env node
// F038.14 — the release harness's two properties, each proven RED first.
//   node scripts/test-verify-release.mjs
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOne, table, ReleaseVerifyError } from "./verify-release.mjs";

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); failures++; }
};
const throwsVerify = (fn, re) => {
  try { fn(); } catch (e) { if (!(e instanceof ReleaseVerifyError)) throw e; if (!re.test(e.message)) throw new Error(`message: ${e.message}`); return; }
  throw new Error("expected a ReleaseVerifyError, got none");
};
// A fake installer that puts version `got` on disk whatever was asked for — the
// exact shape of the 2026-09-03 defect (a stale node_modules answering).
const fakeInstall = (got) => (dir, spec) => {
  const pkg = spec.slice(0, spec.lastIndexOf("@"));
  const at = join(dir, "node_modules", ...pkg.split("/"));
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "package.json"), JSON.stringify({ name: pkg, version: got }));
  writeFileSync(join(at, "index.js"), `export const v = ${JSON.stringify(got)};`);
};
const probeDir = mkdtempSync(join(tmpdir(), "vr-probe-"));
const probe = join(probeDir, "p.mjs");
writeFileSync(probe, `console.log("probe ran for", process.env.VERIFY_VERSION);`);

console.log("verify-release");

check("the row shows the version that RESOLVED, and a different one is refused (the 0.3.2-vs-itself defect)", () => {
  throwsVerify(() => runOne({ pkg: "@broberg/x", version: "0.3.3", probe, install: fakeInstall("0.3.2") }), /asked for 0\.3\.3, the install RESOLVED 0\.3\.2/);
});

check("a version that cannot be installed FAILS LOUDLY, naming it", () => {
  throwsVerify(() => runOne({ pkg: "@broberg/x", version: "9.9.9", probe, install: () => { throw new ReleaseVerifyError("npm could not install @broberg/x@9.9.9: ETARGET"); } }), /9\.9\.9: ETARGET/);
});

check("an install that 'succeeds' with nothing on disk is refused", () => {
  throwsVerify(() => runOne({ pkg: "@broberg/x", version: "1.0.0", probe, install: () => {} }), /package\.json is missing/);
});

check("a matching install runs the probe in its OWN dir with VERIFY_VERSION set", () => {
  const r = runOne({ pkg: "@broberg/x", version: "1.0.0", probe, install: fakeInstall("1.0.0") });
  if (r.resolved !== "1.0.0" || r.exit !== 0 || r.out !== "probe ran for 1.0.0") throw new Error(JSON.stringify(r));
});

check("side by side: identical columns are FLAGGED as a control that did not discriminate", () => {
  const a = { requested: "1.0.0", resolved: "1.0.0", exit: 0, out: "OK" };
  const t = table("@broberg/x", a, { ...a, requested: "1.0.1", resolved: "1.0.1" });
  if (!/SAME OUTPUT in both columns/.test(t)) throw new Error(t);
  const d = table("@broberg/x", a, { requested: "1.0.1", resolved: "1.0.1", exit: 0, out: "REJECTS" });
  if (!/control discriminated/.test(d) || !/OK .*REJECTS/.test(d)) throw new Error(d);
});

check("columns that differ ONLY by the measured version line are still flagged — the version is not a finding", () => {
  const t = table("@broberg/x", { requested: "0.1.0", resolved: "0.1.0", exit: 0, out: "measured 0.1.0\nok, 6 methods" },
    { requested: "0.2.0", resolved: "0.2.0", exit: 0, out: "measured 0.2.0\nok, 6 methods" });
  if (!/SAME OUTPUT in both columns/.test(t)) throw new Error(t);
});

console.log(failures ? `\n${failures} FAILED` : "\nall green");
process.exit(failures ? 1 : 0);

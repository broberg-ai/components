#!/usr/bin/env node
// F105.1 — the image-hygiene decision and the workflow's load-bearing shape.
//   node scripts/test-image-hygiene.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { countVulns, decide } from "./image-hygiene-decide.mjs";

let failures = 0;
const check = (n, f) => { try { f(); console.log(`  ✓ ${n}`); } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); failures++; } };
const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${w}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`); };
const v = (id, pkg, sev, fixed) => ({ VulnerabilityID: id, PkgName: pkg, Severity: sev, FixedVersion: fixed });

console.log("image-hygiene");

check("a CRITICAL with a fix BLOCKS the deploy", () => {
  const c = countVulns({ Results: [{ Vulnerabilities: [v("CVE-1", "openssl", "CRITICAL", "3.0.15")] }] });
  eq(c, { critical_fixable: 1, critical_unfixable: 0, high: 0 }, "counts");
  eq(decide(c), { status: "blocked", deploy: false, red: true }, "decision");
});

check("a CRITICAL without a fix is DEPLOYED — and red", () => {
  const c = countVulns({ Results: [{ Vulnerabilities: [v("CVE-2", "zlib", "CRITICAL", "")] }] });
  eq(decide(c), { status: "ok", deploy: true, red: true }, "decision");
});

check("only HIGH → deployed, not red", () => {
  const c = countVulns({ Results: [{ Vulnerabilities: [v("CVE-3", "curl", "HIGH", "8.1")] }] });
  eq(c.high, 1, "high");
  eq(decide(c), { status: "ok", deploy: true, red: false }, "decision");
});

check("the same CVE in the same package across layers counts once", () => {
  const same = v("CVE-4", "glibc", "CRITICAL", "2.40");
  eq(countVulns({ Results: [{ Vulnerabilities: [same] }, { Vulnerabilities: [same] }] }).critical_fixable, 1, "once");
});

check("an unreadable report is FAILED and never deploys (the CLI path)", () => {
  const out = JSON.parse(execFileSync("node", [new URL("./image-hygiene-decide.mjs", import.meta.url).pathname, "/nonexistent/trivy.json"], { encoding: "utf8" }));
  eq([out.status, out.deploy], ["failed", false], "blind deploy refused");
});

const wf = readFileSync(new URL("../.github/workflows/image-hygiene.yml", import.meta.url), "utf8");
check("one run per app: concurrency group keyed by the app, never cancelling", () => {
  if (!/group: image-hygiene-\$\{\{ inputs\.app \}\}/.test(wf)) throw new Error("no per-app concurrency group");
  if (!/cancel-in-progress: false/.test(wf)) throw new Error("cancel-in-progress must be false");
});
check("the only Fly credential is the CALLER's own FLY_API_TOKEN", () => {
  const secrets = [...wf.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  eq([...new Set(secrets)], ["FLY_API_TOKEN"], "secrets referenced");
});
check("reports to cardmem with GitHub's OIDC token (audience cardmem) — and a failed report never fails the run", () => {
  if (!/id-token: write/.test(wf)) throw new Error("id-token: write missing");
  if (!/audience=cardmem/.test(wf)) throw new Error("OIDC audience must be cardmem");
  if (!/services\.cardmem\.com\/api\/pipeline\/report/.test(wf)) throw new Error("report endpoint missing");
  const step = wf.slice(wf.indexOf("- name: Send to cardmem"), wf.indexOf("- uses: actions/upload-artifact"));
  if (/exit 1/.test(step)) throw new Error("the report step must never fail the run");
  if (!/continue-on-error: true/.test(step)) throw new Error("the report step needs continue-on-error: true (bash -e would otherwise fail it)");
});
check("build-only first, then deploy THAT image (no second build)", () => {
  const b = wf.indexOf("--build-only --push --no-cache"), d = wf.indexOf('--image "$IMAGE"');
  if (b < 0 || d < 0 || d < b) throw new Error("expected a build-only push before deploying --image");
  if ((wf.match(/flyctl deploy/g) ?? []).length !== 2) throw new Error("exactly two flyctl deploy calls (build-only + --image)");
});

console.log(failures ? `\n${failures} FAILED` : "\nall green");
process.exit(failures ? 1 : 0);

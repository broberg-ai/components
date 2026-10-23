#!/usr/bin/env node
// F105.1 — the image-hygiene decision and the workflow's load-bearing shape.
//   node scripts/test-image-hygiene.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { countVulns, decide } from "./image-hygiene-decide.mjs";
import { parseOsRelease, lastFrom, baseImageException } from "./image-hygiene-base.mjs";
import { superseded } from "./image-hygiene-superseded.mjs";

let failures = 0;
const check = (n, f) => { try { f(); console.log(`  ✓ ${n}`); } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); failures++; } };
const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${w}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`); };
const v = (id, pkg, sev, fixed) => ({ VulnerabilityID: id, PkgName: pkg, Severity: sev, FixedVersion: fixed });

console.log("image-hygiene");

check("a CRITICAL with a fix BLOCKS the deploy", () => {
  const c = countVulns({ Results: [{ Vulnerabilities: [v("CVE-1", "openssl", "CRITICAL", "3.0.15")] }] });
  eq(c, { critical_fixable: 1, critical_unfixable: 0, high: 0, vulnerabilities: [{ id: "CVE-1", pkg: "openssl", fixed: "3.0.15" }], vulnerabilities_unfixable: [] }, "counts");
  eq(decide(c), { status: "blocked", deploy: false, red: true }, "decision");
});

check("a CRITICAL without a fix is DEPLOYED — and red", () => {
  const c = countVulns({ Results: [{ Vulnerabilities: [v("CVE-2", "zlib", "CRITICAL", "")] }] });
  eq(decide(c), { status: "ok", deploy: true, red: true }, "decision");
});

check("F105.6: a CRITICAL without a fix is NAMED in vulnerabilities_unfixable, the fixable list stays separate", () => {
  const c = countVulns({ Results: [{ Vulnerabilities: [v("CVE-2", "zlib", "CRITICAL", ""), v("CVE-1", "openssl", "CRITICAL", "3.0.15"), v("CVE-3", "curl", "HIGH", "")] }] });
  eq([c.vulnerabilities_unfixable, c.vulnerabilities.map((x) => x.id)], [[{ id: "CVE-2", pkg: "zlib" }], ["CVE-1"]], "lists");
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

check("only criticals WITH a fix are named, at most 50", () => {
  const many = Array.from({ length: 60 }, (_, i) => v(`CVE-${i}`, "p", "CRITICAL", "1.0"));
  const c = countVulns({ Results: [{ Vulnerabilities: [...many, v("CVE-x", "zlib", "CRITICAL", ""), v("CVE-h", "curl", "HIGH", "8")] }] });
  eq([c.critical_fixable, c.vulnerabilities.length, c.vulnerabilities.some((x) => x.id === "CVE-x")], [60, 50, false], "named list");
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

check("the scanned image is pinned by digest, the pull waits for the registry, and a failed build is not hidden by tee", () => {
  if (!/@sha256:\[0-9a-f\]\{64\}/.test(wf)) throw new Error("no digest extraction from the build log");
  if (!/IMAGE=registry\.fly\.io\/\$APP@\$DIGEST/.test(wf)) throw new Error("IMAGE is not pinned by digest");
  if (!/for i in 1 2 3 4 5 6 7 8; do docker pull "\$IMAGE" && break/.test(wf)) throw new Error("no bounded retry on the pull");
  const build = wf.slice(wf.indexOf("- name: Rebuild with no cache"), wf.indexOf("- name: Scan that image"));
  if (/\| tee/.test(build) && !/set -o pipefail/.test(build)) throw new Error("tee without pipefail hides a failed build");
});
check("the report names the blocking criticals (detail.vulnerabilities)", () => {
  if (!/vulnerabilities: d\.vulnerabilities/.test(wf)) throw new Error("detail.vulnerabilities not reported");
});

check("F105.3: node_version is measured on the SAME digest, is null when absent, and can never fail the run", () => {
  const scanStep = wf.slice(wf.indexOf("- name: Scan that image"), wf.indexOf("- name: Decide"));
  if (!/docker run --rm --entrypoint node "\$IMAGE" -v 2>\/dev\/null[^\n]*\|\| true\)/.test(scanStep)) throw new Error("node -v must run on \"$IMAGE\" (the scanned digest) and end in || true");
  if (!/grep -Eq '\^v\[0-9\]\+/.test(scanStep)) throw new Error("only a v<major>.<minor>.<patch> string may be recorded");
  if (!/node_version: process\.env\.NODE_VERSION \|\| null/.test(wf)) throw new Error("report must send node_version, null when empty");
});

check("the hygiene build passes BUILD_SHA, so /health keeps its build marker", () => {
  const build = wf.slice(wf.indexOf("- name: Rebuild with no cache"), wf.indexOf("- name: Scan that image"));
  if (!/--build-arg BUILD_SHA="\$\{\{ github\.sha \}\}"/.test(build)) throw new Error("build-only step must pass --build-arg BUILD_SHA=${{ github.sha }}");
});

check("F105.4: base_os comes out of the SAME digest without a shell, the script ships with the engine, and the report carries both fields", () => {
  const scanStep = wf.slice(wf.indexOf("- name: Scan that image"), wf.indexOf("- name: Decide"));
  if (!/docker create "\$IMAGE"/.test(scanStep)) throw new Error("os-release must be read from \"$IMAGE\" (the scanned digest)");
  if (!/docker cp -L "\$CID:\/etc\/os-release"/.test(scanStep)) throw new Error("os-release must be copied out with docker cp -L (no shell in the image needed)");
  if (!/image-hygiene-base\.mjs os-release "\$DFP" > base\.json 2>\/dev\/null \|\| echo/.test(scanStep)) throw new Error("the base script must never fail the run");
  if (!/sparse-checkout: \|[\s\S]*scripts\/image-hygiene-base\.mjs/.test(wf)) throw new Error("the engine checkout must include image-hygiene-base.mjs");
  if (!/base_os: base\.base_os \?\? null,/.test(wf) || !/base_image: base\.base_image \?\? null,/.test(wf) || !/base_image_exception: base\.base_image_exception \?\? null,/.test(wf)) throw new Error("report must send base_os + base_image + base_image_exception, null when unknown");
});

check("F105.6: the report sends vulnerabilities_unfixable and the Trivy JSON is kept as an artifact", () => {
  if (!/vulnerabilities_unfixable: d\.vulnerabilities_unfixable \?\? \[\],/.test(wf)) throw new Error("report must send vulnerabilities_unfixable");
  if (!/name: image-hygiene-trivy, path: trivy\.json/.test(wf)) throw new Error("trivy.json must be uploaded");
});

check("F105.7: every job in the engine carries its own timeout-minutes (a caller's uses: job cannot)", () => {
  const jobsBlock = wf.slice(wf.indexOf("\njobs:"));
  const jobs = [...jobsBlock.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map((m) => m[1]);
  if (jobs.length === 0) throw new Error("no jobs found");
  const missing = jobs.filter((j) => {
    const start = jobsBlock.indexOf(`\n  ${j}:`);
    const rest = jobsBlock.slice(start + 1);
    const next = rest.slice(1).search(/\n  [a-zA-Z0-9_-]+:\s*\n/);
    const body = next === -1 ? rest : rest.slice(0, next + 1);
    return !/\n    timeout-minutes: \d+/.test(body);
  });
  eq(missing, [], "jobs without timeout-minutes");
});

// ── F105.8: never deploy older code than what runs ─────────────────────────
const START = Date.parse("2026-10-23T15:38:00Z");
const rel = (v, at, img = `registry.fly.io/cardmem:sha-${v}`) => ({ Version: v, CreatedAt: at, ImageRef: img });
check("F105.8: cardmem's measured case — a release created DURING the run → skip, and it names the winner", () => {
  const r = superseded({ releases: [rel(2928, "2026-10-23T15:32:00Z"), rel(2929, "2026-10-23T15:42:00Z")], runStartedMs: START, runSha: "9e79dca2", branchHeadSha: "9e79dca2", onDefaultBranch: true });
  eq([r.skip, r.reason, r.winner.startsWith("release v2929")], [true, "superseded", true], "skip");
});
check("F105.8: the default branch moved during the run → skip, even with no new release yet", () => {
  const r = superseded({ releases: [rel(2928, "2026-10-23T15:32:00Z")], runStartedMs: START, runSha: "9e79dca2", branchHeadSha: "e6dc8467", onDefaultBranch: true });
  eq([r.skip, r.reason], [true, "superseded"], "skip");
});
check("F105.8: nothing newer → deploy", () => {
  eq(superseded({ releases: [rel(2928, "2026-10-23T15:32:00Z")], runStartedMs: START, runSha: "9e79dca2", branchHeadSha: "9e79dca2", onDefaultBranch: true }).skip, false, "deploy");
  eq(superseded({ releases: [rel(2928, "2026-10-23T15:32:00Z")], runStartedMs: START, runSha: "abc", branchHeadSha: null, onDefaultBranch: false }).skip, false, "off default branch, no new release");
});
check("F105.8: anything unreadable → skip, never deploy blind", () => {
  eq([
    superseded({ releases: null, runStartedMs: START, runSha: "a", branchHeadSha: "a", onDefaultBranch: true }).skip,
    superseded({ releases: [rel(1, "not a date")], runStartedMs: START, runSha: "a", branchHeadSha: "a", onDefaultBranch: true }).skip,
    superseded({ releases: [rel(1, "2026-10-23T15:00:00Z")], runStartedMs: START, runSha: "a", branchHeadSha: null, onDefaultBranch: true }).skip,
  ], [true, true, true], "skip all");
});
check("F105.8: the workflow asks right before deploying, the deploy is gated on it, and skipped is not red", () => {
  const between = wf.slice(wf.indexOf("- name: Decide"), wf.indexOf("- name: Deploy exactly the scanned image"));
  if (!/image-hygiene-superseded\.mjs releases\.json "\$RUN_STARTED_MS"/.test(between)) throw new Error("the superseded check must run between Decide and Deploy");
  if (!/if: steps\.decide\.outputs\.deploy == 'true' && steps\.superseded\.outputs\.skip != 'true'/.test(wf)) throw new Error("deploy must be gated on the superseded check");
  if (!/RUN_STARTED_MS=\$\(date \+%s%3N\)/.test(wf.slice(0, wf.indexOf("- name: Rebuild with no cache")))) throw new Error("the start must be marked BEFORE the build");
  if (!/r\.status !== "skipped"/.test(wf)) throw new Error("a skipped run must not end red");
  if (!/sparse-checkout: \|[\s\S]*scripts\/image-hygiene-superseded\.mjs/.test(wf)) throw new Error("the engine checkout must include image-hygiene-superseded.mjs");
});

// ── F105.4: base_os + base_image ─────────────────────────────────────────────
// Real /etc/os-release texts (debian:12-slim, alpine:3.20, ubuntu:24.04).
const DEBIAN = 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"\nVERSION="12 (bookworm)"\nVERSION_CODENAME=bookworm\nID=debian\nHOME_URL="https://www.debian.org/"\n';
const ALPINE = 'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.20.3\nPRETTY_NAME="Alpine Linux v3.20"\n';
const UBUNTU = 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\nID_LIKE=debian\n';

check("os-release → \"<ID> <VERSION_ID>\" for debian, alpine, ubuntu", () => {
  eq([parseOsRelease(DEBIAN), parseOsRelease(ALPINE), parseOsRelease(UBUNTU)], ["debian 12", "alpine 3.20.3", "ubuntu 24.04"], "distros");
});
check("os-release without ID is unknown (null), without VERSION_ID it is the ID alone", () => {
  eq([parseOsRelease('NAME="x"\n'), parseOsRelease(""), parseOsRelease("ID=distroless\n")], [null, null, "distroless"], "edges");
});
check("the LAST FROM wins in a multi-stage build; --platform and AS are skipped", () => {
  const df = "FROM --platform=linux/amd64 node:24 AS build\nRUN npm ci\nFROM --platform=$TARGETPLATFORM node:24-slim AS run\nCOPY --from=build /app /app\n";
  eq(lastFrom(df), "node:24-slim", "last stage");
});
check("a lowercase, indented or line-continued FROM is still a FROM; none → null", () => {
  eq([lastFrom("  from oven/bun:1-slim\n"), lastFrom("FROM \\\n  node:24-slim\n"), lastFrom("RUN echo FROM x\n")], ["oven/bun:1-slim", "node:24-slim", null], "variants");
});
check("a \"# base-image exception: <reason>\" line is the exception; none → null", () => {
  eq([
    baseImageException("# base-image exception: python runtime for whisper\nFROM python:3.12-slim\n"),
    baseImageException("FROM node:24-slim\n  #   Base-Image Exception:  needs glibc tools  \n"),
    baseImageException("FROM node:24-slim\n# base image is slim\n"),
  ], ["python runtime for whisper", "needs glibc tools", null], "exception");
});
check("the CLI answers null for what it cannot read — never throws", () => {
  const out = JSON.parse(execFileSync("node", [new URL("./image-hygiene-base.mjs", import.meta.url).pathname, "/nonexistent/os-release", "/nonexistent/Dockerfile"], { encoding: "utf8" }));
  eq(out, { base_os: null, base_image: null, base_image_exception: null }, "unknown");
});

console.log(failures ? `\n${failures} FAILED` : "\nall green");
process.exit(failures ? 1 : 0);

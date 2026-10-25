#!/usr/bin/env node
// F038.44 — the daily roster catch-up, proven against the REAL roster and a stub
// registry, plus the claims about its workflow a comment cannot prove.
//
//   node scripts/test-roster-catch-up.mjs
//
// Three registry states, each a different answer the catch-up must give:
//   in sync          → lists nothing, exit 0
//   one row behind   → lists exactly that row with npm's version, exit 0
//   one row AHEAD    → exit 1 and never listed (the 404 direction, never auto-fixed)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA } from "./inventory-data.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/check-roster-versions.mjs");

let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
};

const roster = new Map();
for (const it of DATA.flatMap((L) => L.items ?? [])) {
  if (it.s === "shipped" && String(it.pkg ?? "").startsWith("@broberg/")) roster.set(it.pkg, it.ver);
}
const [target, targetVer] = [...roster.entries()][0];
const bump = (v) => v.split(".").map((n, i) => (i === 2 ? Number(n) + 1 : n)).join(".");

/** Serve every package at its roster version, except the overrides. */
async function withRegistry(overrides, fn) {
  const server = createServer((req, res) => {
    const pkg = decodeURIComponent(req.url.slice(1));
    const ver = overrides[pkg] ?? roster.get(pkg);
    if (!ver) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ "dist-tags": { latest: ver } }));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(url);
  } finally {
    server.close();
  }
}

const run = (registry) =>
  new Promise((ok) => {
    // async spawn: a sync one would block the event loop that serves the stub
    const p = spawn(process.execPath, [SCRIPT, "--list-behind"], { env: { ...process.env, NPM_REGISTRY: registry } });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => ok({ code, out, err }));
  });

{
  const r = await withRegistry({}, run);
  check("in sync → lists nothing, exit 0", r.code === 0 && r.out.trim() === "", `code=${r.code} out=${JSON.stringify(r.out)}`);
}
{
  const newer = bump(targetVer);
  const r = await withRegistry({ [target]: newer }, run);
  check(
    "one row behind → exactly `<pkg> <npm version>` on stdout, exit 0",
    r.code === 0 && r.out.trim() === `${target} ${newer}`,
    `code=${r.code} out=${JSON.stringify(r.out)} want=${JSON.stringify(`${target} ${newer}`)}`,
  );
}
{
  const r = await withRegistry({ [target]: "0.0.0" }, run);
  check(
    "one row AHEAD → exit 1 and NOT listed (never auto-fixed)",
    r.code === 1 && r.out.trim() === "" && /NPM DOES NOT SERVE/.test(r.err),
    `code=${r.code} out=${JSON.stringify(r.out)}`,
  );
}

// ---------------------------------------------------------------------------
// The workflow: its clock, its one permission, and that it reuses the guarded
// bump rather than editing the roster itself.
// ---------------------------------------------------------------------------
const wf = readFileSync(join(ROOT, ".github/workflows/roster-catch-up.yml"), "utf8");
const discovery = readFileSync(join(ROOT, ".github/workflows/inventory-fresh.yml"), "utf8");
{
  const mine = /cron:\s*"(\d+) (\d+) \* \* \*"/.exec(wf);
  const theirs = /cron:\s*"(\d+) (\d+) \* \* \*"/.exec(discovery);
  const minutes = (m) => Number(m[2]) * 60 + Number(m[1]);
  check(
    "runs daily BEFORE Discovery's own scheduled deploy",
    mine && theirs && minutes(mine) < minutes(theirs),
    `catch-up ${mine?.slice(1).join(" ")} vs discovery ${theirs?.slice(1).join(" ")}`,
  );
  check("can be started by hand (workflow_dispatch)", /\n\s+workflow_dispatch:/.test(wf));
  check("asks the detector which rows are behind (--list-behind)", wf.includes("check-roster-versions.mjs --list-behind"));
  check("bumps through the guarded script, never inline sed", wf.includes("scripts/bump-roster-version.mjs") && !/\bsed\s+-i/.test(wf));
  check("npm-unreachable (exit 2) skips the row instead of failing", /"\$code" = "2"[\s\S]{0,200}continue/.test(wf));
  check("regenerates docs/ in the same commit", wf.includes("build-inventory.mjs") && wf.includes("build-onboarding.mjs") && wf.includes("git add scripts/inventory-data.mjs docs/"));
  check("retries the push from a fresh main, never rebases or forces", /for attempt in 1 2 3 4 5/.test(wf) && !/rebase|--force/.test(wf.replace(/^\s*#.*$/gm, "")));
  check("its only permission is contents: write", (wf.match(/^\s+[a-z-]+: (read|write)/gm) ?? []).map((s) => s.trim()).join() === "contents: write");
}

if (failed) {
  console.error(`\n✗ ${failed} check(s) failed`);
  process.exit(1);
}
console.log("\n✓ roster catch-up: 3 registry states + 8 workflow checks");

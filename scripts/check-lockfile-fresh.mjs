#!/usr/bin/env node
// F033.11 fallout — the local gate could not see what CI checks.
//
// MEASURED 2026-09-10: `pnpm test` passed locally with pnpm-lock.yaml out of
// sync with packages/logger/package.json, because a local run installs nothing
// — node_modules was already there. CI runs `pnpm install --frozen-lockfile`,
// which refuses. Two releases were tagged on a local green and blocked in the
// cloud:
//
//   ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because
//   pnpm-lock.yaml is not up to date with <ROOT>/packages/logger/package.json
//
// Editing a dependency by hand is the normal way to get here, and nothing local
// said a word. So the gate now asks the SAME question CI asks, before a push
// rather than after a tag.
//
// `--lockfile-only` is what keeps this cheap: it resolves and validates without
// touching node_modules, so the check costs a couple of seconds and cannot
// disturb a working install.
import { spawnSync } from "node:child_process";

const r = spawnSync("pnpm", ["install", "--frozen-lockfile", "--lockfile-only"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;

// A crash is its own outcome and must never read as a pass — the whole point of
// this file is that a check which did not answer is not a check that answered.
if (r.error) {
  console.error(`  ✗ could not run pnpm: ${r.error.message}`);
  console.error("    This check did NOT answer. That is not the same as passing.");
  process.exit(2);
}

if (r.status === 0) {
  console.log("  ✓ pnpm-lock.yaml is in sync with every package.json");
  process.exit(0);
}

console.error("  ✗ pnpm-lock.yaml is OUT OF SYNC with a package.json.");
console.error("");
console.error("    CI installs with --frozen-lockfile and will refuse this, so a");
console.error("    tag pushed now publishes NOTHING and the failure appears after");
console.error("    the release rather than before it.");
console.error("");
console.error("    Fix:  pnpm install --lockfile-only   (then commit pnpm-lock.yaml)");
console.error("");
for (const line of out.split("\n").filter((l) => l.trim()).slice(0, 6)) {
  console.error(`    ${line}`);
}
process.exit(1);

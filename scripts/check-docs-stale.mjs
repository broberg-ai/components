#!/usr/bin/env node
// F038.46 — are the committed Discovery pages stale, and if so, is it OURS?
//
//   bun scripts/check-docs-stale.mjs            (after the surfaces were regenerated)
//
// The pages show every package's newest npm version and publish time, fetched
// live. So a release from ANOTHER repo (lens, auth-relay, ai-sdk …) changes the
// generated pages, and "the committed docs are stale" stopped the Discovery deploy
// five times in a day for something this repo did not do. The owner's answer
// (26/10): that case warns; a change in THIS repo still fails.
//
// How the two are told apart: rebuild once with EXTERNAL packages frozen to the
// committed docs/npm-meta.json (our own packages still asked live). In sync now →
// only external releases moved → warn, exit 0. Still stale → exit 1 as before.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownPackages } from "./npm-latest.mjs";

const DOCS = ["docs/inventory.html", "docs/onboarding.html", "docs/llms.txt", "docs/llms-full.txt"];
const run = (cmd, args, env = {}) => spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
const stale = () => spawnSync("git", ["diff", "--quiet", "--", ...DOCS]).status !== 0;

/** External packages whose npm facts moved between the committed meta and the live one. */
export function movedExternals(committed, live, own) {
  return Object.keys(live)
    .filter((pkg) => !own.has(pkg))
    .filter((pkg) => committed[pkg]?.version !== live[pkg]?.version || committed[pkg]?.publishedAt !== live[pkg]?.publishedAt)
    .map((pkg) => `${pkg} ${committed[pkg]?.version ?? "?"} → ${live[pkg]?.version ?? "?"}`);
}

if (import.meta.main ?? process.argv[1]?.endsWith("check-docs-stale.mjs")) {
  if (!stale()) {
    console.log("Discovery docs are in sync with the single source.");
    process.exit(0);
  }
  const live = JSON.parse(readFileSync("docs/npm-meta.json", "utf8"));
  const committedText = spawnSync("git", ["show", "HEAD:docs/npm-meta.json"], { encoding: "utf8" }).stdout;
  const frozenFile = join(mkdtempSync(join(tmpdir(), "docs-stale-")), "npm-meta.json");
  writeFileSync(frozenFile, committedText);
  const env = { DISCOVERY_FREEZE_EXTERNAL: frozenFile };
  run(process.execPath, ["scripts/build-inventory.mjs"], env);
  run(process.execPath, ["scripts/build-onboarding.mjs"], env);

  if (!stale()) {
    const moved = movedExternals(JSON.parse(committedText), live, ownPackages());
    console.log(
      `::warning::Discovery docs differ only because a package published from ANOTHER repo moved on npm (${moved.join(", ") || "publish time"}). ` +
        "Not a failure (F038.45/F038.46): the daily catch-up regenerates them, or run bun scripts/build-inventory.mjs && bun scripts/build-onboarding.mjs and commit docs/.",
    );
    process.exit(0);
  }
  console.log("::error::Discovery docs are stale vs scripts/inventory-data.mjs — run: bun scripts/build-inventory.mjs && bun scripts/build-onboarding.mjs, then commit docs/.");
  spawnSync("git", ["--no-pager", "diff", "--stat", "--", "docs/"], { stdio: "inherit" });
  process.exit(1);
}

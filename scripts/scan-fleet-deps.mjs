#!/usr/bin/env node
// F083 — who actually depends on a @broberg/* package.
//
// Reads EVERY package.json on the default branch of every cardmem repo, straight
// from GitHub, and derives the real who-depends-on-what graph. This replaces a
// hand-written array of 11 rows that could only ever be as fresh as the last
// person who remembered to edit it.
//
// MEASURED 2026-09-03, the first full run: 32 repos, 179 manifests, 149 real
// dependency edges — against 15 shown on the page. Eight repos had no row at
// all, and every one of the eleven that existed understated, including our own
// (said 0, real 7).
//
// WHAT THIS MEASURES, precisely, because the distinction matters and a reader
// will otherwise assume something stronger:
//   package.json dependencies = what a repo DECLARES it installs.
//   NOT what it imports (a declared dep can sit unused).
//   NOT what is deployed (a branch is not a release).
//   It IS what npm would install, which is the question a reuse roster answers.
//
// Walking the whole tree is load-bearing, not thoroughness for its own sake:
// components has 41 manifests, cms 32, trail 21, buddy 11. Reading only the root
// package.json reports ZERO for the fleet's heaviest consumers.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

/** Only the shared inventory. Everything else is each repo's own business. */
export const SHARED = /^@(broberg|upmetrics)\//;

/** The four fields npm installs from. A devDependency and a runtime dependency
 *  are different facts about a repo, so the field travels with the edge. */
export const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

const ghCli = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 64e6 }));

/**
 * Scan one repo. `api` is injected so the tests can drive this without a network
 * — a scanner whose only proof is "it ran against GitHub once" has no negative
 * controls at all.
 *
 * THROWS when it read zero manifests. That is @broberg/greppable's rule applied
 * here: a run that never looked must not report clean, because a clean-looking
 * empty result CLOSES the question. The likely cause of zero is a wrong repo, a
 * renamed branch or a permissions failure — i.e. exactly when a confident
 * all-clear is most wrong.
 */
export function scanRepo(repo, api = ghCli) {
  const branch = api(`repos/${repo}`).default_branch;
  if (!branch) throw new Error(`${repo}: no default branch in the API response`);
  const tree = api(`repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`).tree || [];
  const manifests = tree.filter(
    (t) => t.type === "blob" && /(^|\/)package\.json$/.test(t.path) && !t.path.split("/").includes("node_modules"),
  );
  if (manifests.length === 0) throw new Error(`${repo}: no package.json found on ${branch} — refusing to report this as "no dependencies"`);

  const deps = {};
  let unreadable = 0;
  for (const f of manifests) {
    let json;
    try {
      json = JSON.parse(Buffer.from(api(`repos/${repo}/git/blobs/${f.sha}`).content, "base64").toString());
    } catch {
      // Counted in its OWN field. A manifest we could not parse is NOT a
      // manifest with no dependencies, and merging the two is how a broken read
      // becomes a clean-looking result.
      unreadable++;
      continue;
    }
    for (const field of DEP_FIELDS) {
      for (const [name, range] of Object.entries(json[field] || {})) {
        if (!SHARED.test(name)) continue;
        (deps[name] ??= []).push({ range, field, at: f.path });
      }
    }
  }
  return { branch, manifests: manifests.length, unreadable, deps };
}

/** Scan many. A repo that FAILS is recorded as an error and never as an empty
 *  result — those are different facts and only one of them is safe to act on. */
export function scanFleet(repos, api = ghCli, log = () => {}) {
  const repos_ = {};
  for (const repo of repos) {
    try {
      repos_[repo] = scanRepo(repo, api);
      const r = repos_[repo];
      log(`${repo.padEnd(38)} ${String(r.manifests).padStart(3)} manifests  ${String(Object.keys(r.deps).length).padStart(2)} shared deps${r.unreadable ? `  (${r.unreadable} UNREADABLE)` : ""}`);
    } catch (e) {
      repos_[repo] = { error: String(e.message || e).split("\n")[0].slice(0, 200) };
      log(`${repo.padEnd(38)} ERROR ${repos_[repo].error}`);
    }
  }
  const ok = Object.values(repos_).filter((r) => !r.error);
  return {
    scanned_at: new Date().toISOString(),
    repos_scanned: ok.length,
    repos_failed: Object.values(repos_).filter((r) => r.error).length,
    manifests_read: ok.reduce((n, r) => n + r.manifests, 0),
    manifests_unreadable: ok.reduce((n, r) => n + r.unreadable, 0),
    edges: ok.reduce((n, r) => n + Object.keys(r.deps).length, 0),
    repos: repos_,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const out = outIdx >= 0 ? argv.splice(outIdx, 2)[1] : null;
  if (!argv.length) {
    console.error("usage: scan-fleet-deps.mjs <owner/repo> [...] [--out <file>]");
    process.exit(2);
  }
  const result = scanFleet(argv, ghCli, (line) => console.error(line));
  console.error(`\n${result.repos_scanned} repos · ${result.manifests_read} manifests · ${result.edges} edges · ${result.repos_failed} failed`);
  const json = JSON.stringify(result, null, 1);
  if (out) { writeFileSync(out, json + "\n"); console.error(`wrote ${out}`); }
  else console.log(json);
  // A run where every repo failed is a failed run, not an empty fleet.
  if (result.repos_scanned === 0) process.exit(1);
}

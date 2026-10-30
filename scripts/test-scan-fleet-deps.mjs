#!/usr/bin/env node
// F083.1 — the scanner's tests. Every guard is proven RED first, because the
// whole defect being fixed is a confident number nobody watched fail.
//
//   node scripts/test-scan-fleet-deps.mjs
import { scanRepo, scanFleet, waitOnRateLimit, SHARED, DEP_FIELDS } from "./scan-fleet-deps.mjs";

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); failures++; }
};
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`); };
const throws = (fn, re, what) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  if (msg === null) throw new Error(`${what}: expected a throw, got none`);
  if (!re.test(msg)) throw new Error(`${what}: message did not match ${re}\n  actual: ${msg}`);
};

/** A fake GitHub. `files` maps a path to the object its package.json holds; a
 *  value of the string "BROKEN" produces a blob that will not parse. */
function fakeApi({ branch = "main", files = {}, treeExtra = [] } = {}) {
  const shas = Object.fromEntries(Object.keys(files).map((p, i) => [`sha${i}`, p]));
  return (path) => {
    if (/^repos\/[^/]+\/[^/]+$/.test(path)) return { default_branch: branch };
    if (path.includes("/git/trees/")) {
      return {
        tree: [
          ...Object.entries(shas).map(([sha, p]) => ({ type: "blob", path: p, sha })),
          ...treeExtra,
        ],
      };
    }
    const sha = path.split("/git/blobs/")[1];
    const body = files[shas[sha]];
    // A string body is a raw file (a lockfile); "BROKEN" is one that will not parse.
    const text = body === "BROKEN" ? "{ this is not json" : typeof body === "string" ? body : JSON.stringify(body);
    return { content: Buffer.from(text).toString("base64") };
  };
}

console.log("scan-fleet-deps");

check("reads a manifest at EVERY depth, not just the root", () => {
  const api = fakeApi({ files: {
    "package.json": { dependencies: { "@broberg/a": "1.0.0" } },
    "packages/x/package.json": { dependencies: { "@broberg/b": "2.0.0" } },
    "apps/y/nested/deep/package.json": { dependencies: { "@broberg/c": "3.0.0" } },
  }});
  const r = scanRepo("o/r", api);
  eq(r.manifests, 3, "manifest count");
  eq(Object.keys(r.deps).sort(), ["@broberg/a", "@broberg/b", "@broberg/c"], "deps found at all depths");
});

check("a root-only reader would have reported ZERO for a monorepo — the case this walk exists for", () => {
  const api = fakeApi({ files: {
    "package.json": { name: "root", private: true },            // no deps at the root
    "packages/core/package.json": { dependencies: { "@broberg/mail": "1.0.0" } },
  }});
  const r = scanRepo("o/r", api);
  eq(Object.keys(r.deps), ["@broberg/mail"], "the dep lives below the root");
});

check("node_modules is excluded — at any depth, and only as a whole path SEGMENT", () => {
  const api = fakeApi({ files: {
    "package.json": { dependencies: { "@broberg/a": "1" } },
    "node_modules/evil/package.json": { dependencies: { "@broberg/z": "9" } },
    "packages/x/node_modules/dep/package.json": { dependencies: { "@broberg/y": "9" } },
    "my-node_modules-notes/package.json": { dependencies: { "@broberg/keep": "1" } },
  }});
  const r = scanRepo("o/r", api);
  eq(Object.keys(r.deps).sort(), ["@broberg/a", "@broberg/keep"], "installed copies excluded, a lookalike directory kept");
});

check("all four dependency fields are read, and the FIELD travels with the edge", () => {
  const api = fakeApi({ files: { "package.json": {
    dependencies: { "@broberg/a": "1" },
    devDependencies: { "@broberg/b": "2" },
    peerDependencies: { "@broberg/c": "3" },
    optionalDependencies: { "@broberg/d": "4" },
  }}});
  const r = scanRepo("o/r", api);
  eq(DEP_FIELDS.length, 4, "four fields");
  eq(r.deps["@broberg/b"][0].field, "devDependencies", "a devDependency is recorded AS one");
  eq(r.deps["@broberg/a"][0].range, "1", "the range travels too");
  eq(r.deps["@broberg/a"][0].at, "package.json", "and the manifest path");
});

check("only the shared inventory is collected", () => {
  const api = fakeApi({ files: { "package.json": { dependencies: {
    "@broberg/mail": "1", "@upmetrics/sdk": "2", "zod": "3", "@types/node": "4", "not-broberg": "5",
  }}}});
  const r = scanRepo("o/r", api);
  eq(Object.keys(r.deps).sort(), ["@broberg/mail", "@upmetrics/sdk"], "third-party excluded");
  eq(SHARED.test("@brobergx/no"), false, "the scope must match exactly, not as a prefix");
});

check("an EMPTY TREE throws — a run that never looked must not report clean", () => {
  throws(() => scanRepo("o/r", fakeApi({ files: {} })), /came back EMPTY/, "empty tree");
});

check("a real repo with NO package.json is a normal result, not an error — the two are different facts", () => {
  // Measured: annaslothart and house-of-wellness are docs-only repos. Treating
  // them as failures would paint the daily job red forever, and a check that
  // fires on every run is a check nobody reads.
  const api = fakeApi({ files: { "README.md": {} }, treeExtra: [] });
  const r = scanRepo("o/docs-only", api);
  eq(r.manifests, 0, "no manifests");
  eq(r.no_manifests, true, "and it SAYS so, rather than looking like a scanned repo with no deps");
  eq(r.deps, {}, "no deps");
});

check("an UNPARSEABLE manifest is counted separately, never as 'no dependencies'", () => {
  const api = fakeApi({ files: {
    "package.json": { dependencies: { "@broberg/a": "1" } },
    "packages/broken/package.json": "BROKEN",
  }});
  const r = scanRepo("o/r", api);
  eq(r.manifests, 2, "both counted as manifests");
  eq(r.unreadable, 1, "the broken one is visible AS broken");
  eq(Object.keys(r.deps), ["@broberg/a"], "the readable one still contributes");
});

check("the default branch is RESOLVED, never assumed to be main", () => {
  const api = fakeApi({ branch: "trunk", files: { "package.json": { dependencies: { "@broberg/a": "1" } } } });
  const r = scanRepo("o/r", api);
  eq(r.branch, "trunk", "branch from the API");
});

check("a repo that FAILS is an error row, never merged into the healthy ones", () => {
  const good = fakeApi({ files: { "package.json": { dependencies: { "@broberg/a": "1" } } } });
  const bad = () => { throw new Error("HTTP 404: Not Found"); };
  const api = (p) => (p.includes("gone") ? bad() : good(p));
  const r = scanFleet(["o/good", "o/gone"], api);
  eq(r.repos_scanned, 1, "one scanned");
  eq(r.repos_failed, 1, "one failed");
  eq(r.repos["o/gone"].deps, undefined, "a failed repo has NO deps field to mistake for an empty one");
  if (!/404/.test(r.repos["o/gone"].error)) throw new Error("the reason is kept");
});

check("the summary counts are derived from the scan, not from the input list", () => {
  const api = fakeApi({ files: {
    "package.json": { dependencies: { "@broberg/a": "1" } },
    "packages/x/package.json": { dependencies: { "@broberg/b": "1", "@broberg/a": "1" } },
  }});
  const r = scanFleet(["o/one"], api);
  eq(r.manifests_read, 2, "manifests");
  eq(r.edges, 2, "distinct packages, not occurrences");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(r.scanned_at)) throw new Error("scanned_at is an ISO timestamp");
});

// F083.6 — GitHub's shared quota ran out on 21+22 Oct 2026 and 73 repos were
// recorded as failed. A rate-limit answer means "ask again after the reset".
const rateLimitErr = () => new Error("Command failed: gh api repos/x/y\ngh: API rate limit exceeded for user ID 486755. (HTTP 403)");
check("a rate-limited call waits for the reset and the repo is READ, not failed", () => {
  let calls = 0; const slept = [];
  const inner = fakeApi({ files: { "package.json": { dependencies: { "@broberg/mail": "1.0.0" } } } });
  const api = waitOnRateLimit((p) => { if (++calls === 1) throw rateLimitErr(); return inner(p); },
    { resetAt: () => 1_000_000 + 60_000, now: () => 1_000_000, sleep: (ms) => slept.push(ms) });
  const scan = scanFleet(["broberg-ai/x"], api);
  eq(scan.repos_failed, 0, "no failed repos");
  eq(scan.edges, 1, "the dependency was read");
  eq(slept, [65_000], "waited until reset + 5s");
});
check("negative control: a 404 is NOT waited on — it is still a failed repo", () => {
  const slept = [];
  const api = waitOnRateLimit(() => { throw new Error("Command failed: gh api repos/x/y\ngh: Not Found (HTTP 404)"); },
    { resetAt: () => 0, now: () => 0, sleep: (ms) => slept.push(ms) });
  const scan = scanFleet(["broberg-ai/x"], api);
  eq(scan.repos_failed, 1, "one failed repo");
  eq(slept, [], "never slept");
});
check("a reset further away than the cap is not waited for — the run fails loudly instead of hanging", () => {
  const slept = [];
  const api = waitOnRateLimit(() => { throw rateLimitErr(); },
    { resetAt: () => 2 * 3600e3, now: () => 0, sleep: (ms) => slept.push(ms) });
  eq(scanFleet(["broberg-ai/x"], api).repos_failed, 1, "failed");
  eq(slept, [], "never slept");
});

// F039.6 AC7 — the INSTALLED version, read from the lockfile, never the range.
const occ = (r, pkg) => r.deps[pkg].map(({ at, range, installed, installed_unknown }) => ({ at, range, installed, installed_unknown }));

check("AC7: package.json says ^0.1.0, the lockfile holds 0.1.3 → installed is 0.1.3, NOT 0.1.0", () => {
  const api = fakeApi({ files: {
    "package.json": { dependencies: { "@broberg/a": "^0.1.0" } },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '@broberg/a':\n        specifier: ^0.1.0\n        version: 0.1.3\n",
  }});
  eq(occ(scanRepo("o/r", api), "@broberg/a"), [{ at: "package.json", range: "^0.1.0", installed: "0.1.3" }], "installed from pnpm-lock");
});

check("pnpm monorepo: each importer gets ITS OWN installed version, peer suffix stripped", () => {
  const api = fakeApi({ files: {
    "package.json": { private: true },
    "apps/server/package.json": { dependencies: { "@broberg/ai": "^0.21.1" } },
    "apps/web/package.json": { devDependencies: { "@broberg/ai": "^0.10.4" } },
    "pnpm-lock.yaml": [
      "lockfileVersion: '9.0'", "importers:", "  .: {}",
      "  apps/server:", "    dependencies:", "      '@broberg/ai':", "        specifier: ^0.21.1", "        version: 0.21.4(zod@4.1.0)",
      "  apps/web:", "    devDependencies:", "      '@broberg/ai':", "        specifier: ^0.10.4", "        version: 0.10.9", "",
    ].join("\n"),
  }});
  eq(occ(scanRepo("o/r", api), "@broberg/ai"), [
    { at: "apps/server/package.json", range: "^0.21.1", installed: "0.21.4" },
    { at: "apps/web/package.json", range: "^0.10.4", installed: "0.10.9" },
  ], "two installed versions in one repo");
});

check("package-lock: a nested workspace resolves through the hoisted root node_modules", () => {
  const api = fakeApi({ files: {
    "package.json": { workspaces: ["apps/*"] },
    "apps/x/package.json": { dependencies: { "@broberg/a": "^1.0.0", "@broberg/b": "^2.0.0" } },
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {
      "node_modules/@broberg/a": { version: "1.4.0" },
      "apps/x/node_modules/@broberg/b": { version: "2.2.0" },
      "node_modules/@broberg/b": { version: "2.0.0" },
    } }),
  }});
  const r = scanRepo("o/r", api);
  eq(r.deps["@broberg/a"][0].installed, "1.4.0", "hoisted");
  eq(r.deps["@broberg/b"][0].installed, "2.2.0", "the nearer node_modules wins over the root");
});

check("bun.lock (trailing commas): a workspace's own copy is keyed by its NAME, hoisted otherwise", () => {
  const api = fakeApi({ files: {
    "package.json": { dependencies: { "@broberg/a": "^0.5.0" } },
    "apps/voice/package.json": { dependencies: { "@broberg/a": "0.38.0" } },
    "bun.lock": [
      "{", '  "lockfileVersion": 1,', '  "workspaces": {',
      '    "": { "name": "root", "dependencies": { "@broberg/a": "^0.5.0", }, },',
      '    "apps/voice": { "name": "@w/voice", "dependencies": { "@broberg/a": "0.38.0", }, },',
      "  },", '  "packages": {',
      '    "@broberg/a": ["@broberg/a@0.5.7", "", {}, "sha512-x"],',
      '    "@w/voice/@broberg/a": ["@broberg/a@0.38.0", "", {}, "sha512-y"],',
      "  },", "}", "",
    ].join("\n"),
  }});
  eq(occ(scanRepo("o/r", api), "@broberg/a").map((o) => o.installed), ["0.5.7", "0.38.0"], "root hoisted, voice its own");
});

check("a lockfile OUT OF DATE with package.json claims no version — buddy's real 30 Oct case", () => {
  const api = fakeApi({ files: {
    "apps/server/package.json": { dependencies: { "@broberg/ai-sdk": "0.66.0" } },
    "bun.lock": '{ "workspaces": { "apps/server": { "name": "s", "dependencies": { "@broberg/ai-sdk": "^0.28.0" } } },'
      + ' "packages": { "@broberg/ai-sdk": ["@broberg/ai-sdk@0.28.0", "", {}, "x"] } }',
  }});
  eq(occ(scanRepo("o/r", api), "@broberg/ai-sdk"), [{ at: "apps/server/package.json", range: "0.66.0",
    installed_unknown: "bun.lock out of date with package.json (lock records ^0.28.0)" }], "0.28.0 must NOT be reported as installed");
  const pnpm = fakeApi({ files: {
    "package.json": { dependencies: { "@broberg/a": "^0.2.0" } },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '@broberg/a':\n        specifier: ^0.1.0\n        version: 0.1.3\n",
  }});
  eq(scanRepo("o/r", pnpm).deps["@broberg/a"][0].installed_unknown, "pnpm-lock.yaml out of date with package.json (lock records ^0.1.0)", "pnpm too");
});

check("a peer range next to a workspace devDependency is NOT a stale lock (components' real case)", () => {
  const api = fakeApi({ files: {
    "packages/x/package.json": { devDependencies: { "@broberg/a": "workspace:*" }, peerDependencies: { "@broberg/a": "^0.5.0" } },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  packages/x:\n    devDependencies:\n      '@broberg/a':\n        specifier: workspace:*\n        version: link:../a\n",
  }});
  eq(scanRepo("o/r", api).deps["@broberg/a"].map((o) => o.installed_unknown), ["local link in pnpm-lock.yaml", "local link in pnpm-lock.yaml"], "both fields");
});

check("NO lockfile → installed_unknown says so; the range is never promoted to installed", () => {
  const api = fakeApi({ files: { "package.json": { dependencies: { "@broberg/a": "0.1.0" } } } });
  eq(occ(scanRepo("o/r", api), "@broberg/a"), [{ at: "package.json", range: "0.1.0", installed_unknown: "no lockfile committed" }], "even an exact pin is not called installed");
});

check("an UNREADABLE lockfile is said, never read as 'not installed' — and the manifest still counts", () => {
  const api = fakeApi({ files: { "package.json": { dependencies: { "@broberg/a": "^1" } }, "pnpm-lock.yaml": "BROKEN" } });
  const r = scanRepo("o/r", api);
  eq(r.unreadable, 0, "the manifest itself parsed");
  eq(r.deps["@broberg/a"][0].installed_unknown, "pnpm-lock.yaml unreadable", "reason");
  eq(r.deps["@broberg/a"][0].installed, undefined, "no version claimed");
});

check("a workspace link and an unsupported lockfile both explain themselves", () => {
  const linked = fakeApi({ files: {
    "packages/x/package.json": { dependencies: { "@broberg/a": "workspace:*" } },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  packages/x:\n    dependencies:\n      '@broberg/a':\n        specifier: workspace:*\n        version: link:../a\n",
  }});
  eq(scanRepo("o/r", linked).deps["@broberg/a"][0].installed_unknown, "local link in pnpm-lock.yaml", "link");
  const yarn = fakeApi({ files: { "package.json": { dependencies: { "@broberg/a": "^1" } }, "yarn.lock": "# yarn" } });
  eq(scanRepo("o/r", yarn).deps["@broberg/a"][0].installed_unknown, "yarn.lock is not read", "yarn");
});

console.log(failures ? `\n${failures} FAILED` : "\nall green");
process.exit(failures ? 1 : 0);

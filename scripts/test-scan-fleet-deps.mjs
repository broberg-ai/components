#!/usr/bin/env node
// F083.1 — the scanner's tests. Every guard is proven RED first, because the
// whole defect being fixed is a confident number nobody watched fail.
//
//   node scripts/test-scan-fleet-deps.mjs
import { scanRepo, scanFleet, SHARED, DEP_FIELDS } from "./scan-fleet-deps.mjs";

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
    const text = body === "BROKEN" ? "{ this is not json" : JSON.stringify(body);
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

console.log(failures ? `\n${failures} FAILED` : "\nall green");
process.exit(failures ? 1 : 0);

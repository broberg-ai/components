#!/usr/bin/env node
// Every workflow file must PARSE. Sounds too obvious to test, and it is exactly
// what bit on 2026-09-03: fleet-deps.yml shipped with a commit message whose
// body lines started at column 0, which dedented out of the `run: |` block.
// GitHub's answer was "This run likely failed because of a workflow file issue"
// with no log and no failed step — and `gh workflow run` refused, because an
// unparseable file registers NO triggers at all. So the job did not run, and
// nothing in the repo would ever have said so.
//
//   node scripts/test-workflows-parse.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// `yaml` is a root devDependency. If it is missing the guard has not FAILED —
// it has not RUN, and those must not share an exit code: a caller that treats
// "could not check" as "checked and clean" is the exact defect this file exists
// to catch, one level up.
let yaml;
try {
  yaml = (await import("yaml")).default;
} catch {
  console.error("cannot check: the `yaml` package is not installed (run `pnpm install`, or `npm i yaml --no-save` in a bare job)");
  process.exit(2);
}

const DIR = new URL("../.github/workflows/", import.meta.url).pathname;
let failures = 0;

for (const f of readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n)).sort()) {
  const path = join(DIR, f);
  try {
    const doc = yaml.parse(readFileSync(path, "utf8"));
    if (!doc || typeof doc !== "object") throw new Error("parsed to nothing");
    if (!doc.jobs || !Object.keys(doc.jobs).length) throw new Error("no jobs");
    // `on:` is YAML 1.1's boolean true. A workflow whose triggers silently
    // became a boolean key registers nothing, which is the same invisible
    // failure by a different route.
    const triggers = doc.on ?? doc[true];
    if (!triggers) throw new Error("no triggers (`on:` missing)");
    console.log(`  ✓ ${f}  (${Object.keys(doc.jobs).length} job(s), triggers: ${Object.keys(triggers).join(", ")})`);
  } catch (e) {
    console.log(`  ✗ ${f}\n      ${String(e.message).split("\n")[0]}`);
    failures++;
  }
}

console.log(failures ? `\n${failures} workflow file(s) will not parse` : "\nall workflows parse");
process.exit(failures ? 1 : 0);

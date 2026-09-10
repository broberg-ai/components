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

// --- F083.5: a BARE `git push` needs a branch, and a tag ref has none --------
//
// fleet-deps.yml declared `on.push` with a `paths:` filter and no `branches:`.
// GitHub does not evaluate path filters for TAG pushes, so every `<pkg>-v*`
// release tag started the job — on a detached HEAD, where `git push` with no
// arguments has no upstream to resolve:
//
//   [detached HEAD 3f96b00] chore(fleet): refresh the dependency graph
//   fatal: You are not currently on a branch.
//
// It hid for hours because 4 of 18 tag runs were GREEN: the graph had not moved,
// so the step exited at "no change" one line BEFORE the push. The failing state
// and the passing state are the same code path diverging early, which is why
// looking at the passes would have confirmed the job was fine on tags.
//
// THE RULE IS ABOUT THE BARE PUSH, NOT THE TAG TRIGGER. publish.yml is
// tag-triggered by design and pushes a roster bump correctly, because it makes a
// branch first (`git checkout -B main origin/main`) and then names a refspec
// (`git push origin main`). A rule that banned every push from a tag-triggered
// workflow would redden correct code, and a guard that reddens correct code gets
// switched off.
//
// WHAT THIS DOES NOT PROVE, stated because a guard whose claim is wider than its
// test is how a pass gets read as covering more than it does:
//   · that an explicit-refspec push will SUCCEED — that needs a preceding branch
//     checkout, which lives in shell text this guard does not read;
//   · that `workflow_dispatch` was not run against a tag ref. A human can pick a
//     tag in the Actions UI and land in the same detached HEAD. Only the `push`
//     trigger is modelled here, because that is the one that fires unattended.
// It checks one thing — that a push with nowhere to go cannot be started by a tag
// push — and claims only that.
let unsafe = 0;

/**
 * A BARE `git push` — no remote, no refspec. Flags are allowed (`git push -q`),
 * because those push the current branch too and fail identically on a detached
 * HEAD.
 *
 * The lookahead is what carries the rule, and the first version of it got this
 * wrong: it constrained what came BEFORE `git`, so `if git push; then` — the
 * exact shape publish.yml uses — slipped through and the guard went green on a
 * mutation planted to redden it. What matters is only what comes AFTER: if the
 * command ends there, nothing told git where to push.
 */
function hasBarePush(text) {
  return /(?<![\w./-])git\s+push(?:\s+-{1,2}[\w-]+)*[ \t]*(?=$|[\n;&|)#])/m.test(text);
}

/** Every `run:` script in the file, as one string per workflow. */
function runScripts(doc) {
  const out = [];
  for (const job of Object.values(doc.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.run === "string") out.push(step.run);
    }
  }
  return out.join("\n");
}

/**
 * Can a TAG push start this workflow? Yes when it has an `on.push` trigger and
 * either names tags explicitly, or names no branch filter at all — the second
 * case being the one that looks safe because `paths:` is sitting right there.
 */
function tagReachable(triggers) {
  const push = triggers?.push;
  if (push === undefined || push === null) return false;
  if (typeof push !== "object") return true; // `push:` with an empty value = everything
  if (push.tags || push["tags-ignore"]) return true;
  return !(push.branches || push["branches-ignore"]);
}

for (const f of readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n)).sort()) {
  let doc;
  try {
    doc = yaml.parse(readFileSync(join(DIR, f), "utf8"));
  } catch {
    continue; // already counted as a parse failure above
  }
  if (!doc || typeof doc !== "object") continue;
  const scripts = runScripts(doc);
  if (!hasBarePush(scripts)) continue;
  if (!tagReachable(doc.on ?? doc[true])) continue;
  console.log(
    `  ✗ ${f}\n      runs a BARE \`git push\` and a TAG push can start it — a tag ref is a` +
      `\n      detached HEAD, so that push exits 128. Add \`branches:\` under \`on.push\`` +
      `\n      (paths: does NOT filter tag pushes), or name a refspec after checking out a branch.`,
  );
  unsafe++;
}
console.log(
  unsafe
    ? `${unsafe} workflow(s) push from a ref they may not have`
    : "no workflow runs a bare `git push` where a tag could start it",
);

process.exit(failures || unsafe ? 1 : 0);

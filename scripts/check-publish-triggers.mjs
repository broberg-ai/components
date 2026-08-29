#!/usr/bin/env node
/**
 * F016.8 — every publish JOB must have a matching tag TRIGGER, and vice versa.
 *
 * Found while trying to ship @broberg/ui-controls-core@0.1.1: the tag pushed, the
 * workflow never ran, and nothing said why. The job existed and its `if:` was
 * correct — it simply was not in `on: push: tags:`, so the workflow could not
 * start for it at all.
 *
 * SEVEN packages were in that state: cmdk, consent-cookie, event-log, http,
 * i18n, soundkit, ui-controls-core. Each looked fully configured on the page.
 * @broberg/http is the one that shows the cost: its Trusted Publisher was set up
 * so 0.1.1+ would auto-publish on a tag, and a tag would have done nothing.
 *
 * The failure mode is the reason this file exists: a tag push that matches no
 * trigger is not an error. GitHub does not run the workflow, does not report a
 * skip, and the release simply never happens. A gate nobody has watched fail is
 * not a gate — so this one fails loudly, in `pnpm test`, before a release
 * depends on it.
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
const onBlock = src.slice(src.indexOf("\non:"), src.indexOf("\njobs:"));

const triggers = new Set([...onBlock.matchAll(/- "([a-z0-9-]+)-v\*"/g)].map((m) => m[1]));
const jobs = new Set(
  [...src.matchAll(/startsWith\(github\.ref, 'refs\/tags\/([a-z0-9-]+)-v'\)/g)].map((m) => m[1]),
);

const jobsWithoutTrigger = [...jobs].filter((j) => !triggers.has(j)).sort();
const triggersWithoutJob = [...triggers].filter((t) => !jobs.has(t)).sort();

const problems = [];
if (jobsWithoutTrigger.length) {
  problems.push(
    `publish job(s) that can NEVER fire — no matching tag in \`on: push: tags:\`:\n` +
      jobsWithoutTrigger.map((p) => `    ${p}  (add: - "${p}-v*")`).join("\n") +
      `\n  Tagging these silently does nothing: GitHub does not start the workflow and reports no skip.`,
  );
}
if (triggersWithoutJob.length) {
  problems.push(
    `tag trigger(s) with no job to run — a tag push starts the workflow and publishes nothing:\n` +
      triggersWithoutJob.map((p) => `    ${p}-v*`).join("\n"),
  );
}

if (problems.length) {
  console.error(`✗ publish.yml: job/trigger mismatch\n\n  ${problems.join("\n\n  ")}\n`);
  process.exit(1);
}

console.log(`✓ publish.yml: ${jobs.size} publish jobs, ${triggers.size} tag triggers, all matched`);

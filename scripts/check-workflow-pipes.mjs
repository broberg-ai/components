#!/usr/bin/env node
// F427.1 — a gate piped into `tee` must still FAIL the step.
//
// GitHub's default `run` shell is `bash -e {0}` WITHOUT pipefail: `node check.mjs | tee -a "$GITHUB_STEP_SUMMARY"` exits
// with tee's status, so a red check becomes a green step. Found 20/11 2026: the first end-to-end run of the new
// security-gate went GREEN on components while the same gate is red on a laptop — every gate written as `… | tee`
// swallowed its own failure (security-gate.yml ×4, selftest, and three F115 gates in test.yml). A selftest that runs
// the script directly cannot see it, which is why this check reads the workflows themselves.
//
// A `run:` block that pipes into tee must have ONE of: `shell: bash` on the step (GitHub then uses `-eo pipefail`),
// `defaults.run.shell: bash` on the job or workflow, `set -o pipefail` or `${PIPESTATUS[0]}` in the block, or a `# pipe-ok: <reason>` comment.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { swallowing } from "./security-gate/pipes.mjs";
export { swallowing };

if (import.meta.url === `file://${process.argv[1]}`) {
  const { parse } = await import("yaml");
  const dir = process.argv[2] ?? ".github/workflows";
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  if (files.length === 0) { console.log(`::error::no workflows in ${dir} — nothing was checked`); process.exit(1); }
  let bad = 0;
  for (const f of files) for (const b of swallowing(parse(readFileSync(join(dir, f), "utf8")))) {
    bad++; console.log(`::error file=${join(dir, f)}::${b.job} › ${b.step}: ${b.why}`);
  }
  console.log(`workflow pipes: ${files.length} workflows · ${bad} step(s) that can swallow a failure`);
  process.exit(bad ? 1 : 0);
}

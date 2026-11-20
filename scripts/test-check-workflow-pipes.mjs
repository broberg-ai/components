#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { swallowing } from "./check-workflow-pipes.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const wf = (y) => parse(y);
const BAD = `jobs:\n  a:\n    steps:\n      - name: gate\n        run: node check.mjs | tee -a "$S"\n`;

t("a gate piped into tee with the default shell is caught", () => assert.equal(swallowing(wf(BAD)).length, 1));
t("shell: bash on the step, the job, or the workflow makes it safe", () => {
  assert.equal(swallowing(wf(BAD.replace("        run:", "        shell: bash\n        run:"))).length, 0);
  assert.equal(swallowing(wf(BAD.replace("  a:\n", "  a:\n    defaults: { run: { shell: bash } }\n"))).length, 0);
  assert.equal(swallowing(wf("defaults: { run: { shell: bash } }\n" + BAD)).length, 0);
});
t("set -o pipefail in the block, or a reasoned pipe-ok comment, makes it safe", () => {
  assert.equal(swallowing(wf(BAD.replace("run: node", "run: |\n          set -o pipefail\n          node"))).length, 0);
  assert.equal(swallowing(wf(BAD.replace("run: node", "run: |\n          # pipe-ok: the next line fails on an empty file\n          node"))).length, 0);
});
t("reading ${PIPESTATUS[0]} is a deliberate pipe-status check", () =>
  assert.equal(swallowing(wf(BAD.replace("run: node", "run: |\n          node c.mjs | tee x\n          RC=${PIPESTATUS[0]}\n          node"))).length, 0));
t("a pipe-ok comment WITHOUT a reason does not count; sh/pwsh do not count", () => {
  assert.equal(swallowing(wf(BAD.replace("run: node", "run: |\n          # pipe-ok:\n          node"))).length, 1);
  assert.equal(swallowing(wf(BAD.replace("        run:", "        shell: sh\n        run:"))).length, 1);
});
t("a run block without tee, and uses: steps, are left alone", () =>
  assert.equal(swallowing(wf("jobs:\n  a:\n    steps:\n      - uses: x/y@abc\n      - run: echo hi | grep hi\n")).length, 0));
t("the CLI: red on a bad workflow dir, red on an empty dir, green on this repo", () => {
  const d = mkdtempSync(join(tmpdir(), "pipes-"));
  const run = (dir) => { try { execFileSync("node", ["scripts/check-workflow-pipes.mjs", dir], { stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
  writeFileSync(join(d, "w.yml"), BAD);
  assert.equal(run(d), 1); assert.equal(run(mkdtempSync(join(tmpdir(), "pipes-empty-"))), 1); assert.equal(run(".github/workflows"), 0);
});
console.log(`\n${n} passed`);

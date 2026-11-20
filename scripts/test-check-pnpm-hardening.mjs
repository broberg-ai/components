#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { problems } from "./check-pnpm-hardening.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const GOOD = `packages:\n  - "packages/*"\nonlyBuiltDependencies: []\nminimumReleaseAge: 4320\nminimumReleaseAgeExclude:\n  - "@broberg/*"\nblockExoticSubdeps: true\n`;

t("the real file is clean", () => assert.deepEqual(problems(GOOD), []));
t("the repo's own pnpm-workspace.yaml passes", () => execFileSync("node", ["scripts/check-pnpm-hardening.mjs"], { stdio: "pipe" }));
t("a missing allowlist is a problem", () => assert.equal(problems(GOOD.replace("onlyBuiltDependencies: []\n", "")).length, 1));
t("an allowlist entry needs a reason", () => {
  const bad = GOOD.replace("onlyBuiltDependencies: []", "onlyBuiltDependencies:\n  - esbuild\nminimumReleaseAge2: 1");
  assert.ok(problems(bad).some((x) => x.includes("no reason")));
  const ok = GOOD.replace("onlyBuiltDependencies: []", "onlyBuiltDependencies:\n  - esbuild # downloads its platform binary; reviewed 20/11");
  assert.deepEqual(problems(ok), []);
});
t("minimumReleaseAge removed or lowered is a problem", () => {
  assert.equal(problems(GOOD.replace("minimumReleaseAge: 4320\n", "")).length, 1);
  assert.equal(problems(GOOD.replace("4320", "60")).length, 1);
});
t("excluding anything but @broberg/* is a problem", () =>
  assert.equal(problems(GOOD.replace('- "@broberg/*"', '- "left-pad"')).length, 1));
t("blockExoticSubdeps off or missing is a problem", () => {
  assert.equal(problems(GOOD.replace("true", "false")).length, 1);
  assert.equal(problems(GOOD.replace("blockExoticSubdeps: true\n", "")).length, 1);
});
t("the CLI exits 1 on a weakened file and 0 on a good one", () => {
  const d = mkdtempSync(join(tmpdir(), "pnpmh-"));
  const run = (txt) => { const f = join(d, "w.yml"); writeFileSync(f, txt); try { execFileSync("node", ["scripts/check-pnpm-hardening.mjs", f], { stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
  assert.equal(run(GOOD), 0); assert.equal(run(GOOD.replace("true", "false")), 1);
});
t("an unreadable file is red", () => {
  assert.throws(() => execFileSync("node", ["scripts/check-pnpm-hardening.mjs", "/no/such/file"], { stdio: "pipe" }));
});
console.log(`\n${n} passed`);

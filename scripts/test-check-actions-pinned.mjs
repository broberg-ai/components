#!/usr/bin/env node
// F115.6 — the pin gate must see an unpinned Action, and must not cry wolf.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unpinned } from "./check-actions-pinned.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const SHA = "11d5960a326750d5838078e36cf38b85af677262";

t("a SHA pin passes, with or without the tag comment", () => {
  assert.equal(unpinned(`- uses: actions/checkout@${SHA} # v4`).length, 0);
  assert.equal(unpinned(`    uses: actions/checkout@${SHA}`).length, 0);
});
t("a tag fails", () => assert.equal(unpinned("- uses: actions/checkout@v4").length, 1));
t("a branch fails, third-party or own", () => {
  assert.equal(unpinned("- uses: superfly/flyctl-actions/setup-flyctl@master").length, 1);
  assert.equal(unpinned("  uses: broberg-ai/components/.github/workflows/x.yml@main").length, 1);
});
t("a short or malformed sha fails", () => assert.equal(unpinned("- uses: a/b@11d5960").length, 1));
t("a ref-less uses fails", () => assert.equal(unpinned("- uses: a/b").length, 1));
t("a local ./ workflow and an own release tag pass", () => {
  assert.equal(unpinned("    uses: ./.github/workflows/test.yml").length, 0);
  assert.equal(unpinned("    uses: broberg-ai/components/.github/workflows/secret-gate.yml@secret-gate-v1").length, 0);
});
t("commented-out uses and prose are ignored; the line number is reported", () => {
  assert.equal(unpinned("#   uses: actions/checkout@v4").length, 0);
  assert.equal(unpinned("a\nb\n- uses: actions/checkout@v4")[0].line, 3);
});
t("the CLI: red on an unpinned fixture, red on an empty dir, green when pinned", () => {
  const d = mkdtempSync(join(tmpdir(), "pin-"));
  const run = (dir) => { try { execFileSync("node", ["scripts/check-actions-pinned.mjs", dir], { stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
  mkdirSync(join(d, "bad")); writeFileSync(join(d, "bad", "w.yml"), "- uses: actions/checkout@v4\n");
  mkdirSync(join(d, "ok")); writeFileSync(join(d, "ok", "w.yml"), `- uses: actions/checkout@${SHA} # v4\n`);
  mkdirSync(join(d, "empty"));
  assert.equal(run(join(d, "bad")), 1); assert.equal(run(join(d, "empty")), 1); assert.equal(run(join(d, "ok")), 0);
});
t("THIS repo's workflows are all pinned", () => assert.equal(execFileSync("node", ["scripts/check-actions-pinned.mjs"]).length > 0, true));
console.log(`\n${n} passed`);

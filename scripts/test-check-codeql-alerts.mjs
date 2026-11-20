#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideAlerts } from "./check-codeql-alerts.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const a = (state, sev) => ({ state, rule: { id: "js/x", security_severity_level: sev } });

t("no alerts is clean", () => assert.equal(decideAlerts([]).status, "clean"));
t("an open high or critical alert blocks", () => {
  assert.equal(decideAlerts([a("open", "high")]).status, "blocking");
  assert.equal(decideAlerts([a("open", "critical")]).status, "blocking");
});
t("medium, low and null severity do not block", () =>
  assert.equal(decideAlerts([a("open", "medium"), a("open", "low"), a("open", null)]).status, "clean"));
t("a dismissed or fixed alert does not block", () =>
  assert.equal(decideAlerts([a("dismissed", "critical"), a("fixed", "high")]).status, "clean"));
t("garbage from the API is an error, not clean", () => {
  assert.equal(decideAlerts({ message: "Not Found" }).status, "error");
  assert.equal(decideAlerts(undefined).status, "error");
});
t("the CLI is red without a repo and when the API cannot be read", () => {
  const run = (env, ...args) => { try { execFileSync("node", ["scripts/check-codeql-alerts.mjs", ...args], { stdio: "pipe", env: { ...process.env, GITHUB_REPOSITORY: "", ...env } }); return 0; } catch (e) { return e.status; } };
  assert.equal(run({}), 1);
  assert.equal(run({ GH_TOKEN: "invalid" }, "broberg-ai/__no_such_repo__"), 1);
});
t("the CLI exits 1 on a recorded high alert and 0 on a recorded clean answer", () => {
  const d = mkdtempSync(join(tmpdir(), "cql-"));
  const run = (alerts) => { const f = join(d, "a.json"); writeFileSync(f, JSON.stringify(alerts)); try { execFileSync("node", ["scripts/check-codeql-alerts.mjs", "--alerts-file", f], { stdio: "pipe", env: { ...process.env, GITHUB_REPOSITORY: "x/y" } }); return 0; } catch (e) { return e.status; } };
  assert.equal(run([a("open", "high")]), 1); assert.equal(run([a("open", "low")]), 0); assert.equal(run({ message: "Not Found" }), 1);
});
console.log(`\n${n} passed`);

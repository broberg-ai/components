#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { provenanceOk, signaturesOk, SLSA } from "./verify-provenance.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };

t("a SLSA provenance attestation is accepted", () => assert.equal(provenanceOk(JSON.stringify({ provenance: { predicateType: SLSA } })).ok, true));
t("no attestation, the wrong predicate, empty and garbage are all refused", () => {
  for (const j of ["", "not json", "{}", JSON.stringify({ url: "x" }), JSON.stringify({ provenance: { predicateType: "https://example/other" } })])
    assert.equal(provenanceOk(j).ok, false, j);
});
t("signatures: exit 0 with the verified line passes; non-zero or a silent exit 0 does not", () => {
  assert.equal(signaturesOk(0, "audited 3 packages\n3 packages have verified registry signatures").ok, true);
  assert.equal(signaturesOk(1, "1 package has an invalid registry signature").ok, false);
  assert.equal(signaturesOk(0, "").ok, false);
});
t("the CLI is red for a version that does not exist (and exits 2 without arguments)", () => {
  const run = (...a) => { try { execFileSync("node", ["scripts/verify-provenance.mjs", ...a], { stdio: "pipe", env: { ...process.env, VERIFY_TRIES: "1", VERIFY_WAIT_MS: "1" } }); return 0; } catch (e) { return e.status; } };
  assert.equal(run("@broberg/call", "99.99.99"), 1); assert.equal(run(), 2);
});
console.log(`\n${n} passed`);

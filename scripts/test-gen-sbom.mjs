#!/usr/bin/env node
// F115.4 — the SBOM describes exactly what a package ships, deterministically.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildSbom, purl } from "./gen-sbom.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const HASH = "sha512-" + Buffer.from("abc").toString("base64");
const lock = {
  importers: { "packages/a": { dependencies: { left: { version: "1.0.0" }, "@s/scoped": { version: "2.0.0" }, peerish: { version: "5.0.0" } }, devDependencies: { vitest: { version: "9.9.9" } } } },
  packages: { "peerish@5.0.0": { resolution: { integrity: HASH } }, "left@1.0.0": { resolution: { integrity: HASH } }, "@s/scoped@2.0.0": { resolution: { integrity: HASH } }, "dep@3.0.0": { resolution: { integrity: HASH } } },
  snapshots: { "peerish@5.0.0": {}, "left@1.0.0": { dependencies: { dep: "3.0.0" } }, "@s/scoped@2.0.0": {}, "dep@3.0.0": {} },
};
const pkg = { name: "@broberg/a", version: "1.2.3", dependencies: { left: "^1", "@s/scoped": "^2" }, devDependencies: { peerish: "^5" } };

t("purl encodes the scope", () => assert.equal(purl("@s/x@1.0.0"), "pkg:npm/%40s/x@1.0.0"));
t("it lists shipped dependencies and their transitive tree, and NOT devDependencies", () => {
  const names = buildSbom(lock, "packages/a", pkg).components.map((c) => c.name);
  assert.deepEqual(names, ["@s/scoped", "dep", "left"]);
  assert.ok(!names.includes("vitest"));
  assert.ok(!names.includes("peerish"), "an auto-installed peer / dev-only name in the importer is not shipped");
});
t("an unknown directory throws instead of yielding an empty SBOM", () => assert.throws(() => buildSbom(lock, "packages/zzz", pkg), /not in pnpm-lock/));
t("each component carries the lockfile's integrity hash as hex", () =>
  assert.deepEqual(buildSbom(lock, "packages/a", pkg).components[0].hashes, [{ alg: "SHA-512", content: Buffer.from("abc").toString("hex") }]));
t("it is deterministic: same input, same bytes, same serial", () =>
  assert.equal(JSON.stringify(buildSbom(lock, "packages/a", pkg)), JSON.stringify(buildSbom(lock, "packages/a", pkg))));
t("a changed tree changes the serial", () => {
  const l2 = structuredClone(lock); l2.snapshots["left@1.0.0"].dependencies.dep = "3.0.1"; l2.snapshots["dep@3.0.1"] = {};
  assert.notEqual(buildSbom(lock, "packages/a", pkg).serialNumber, buildSbom(l2, "packages/a", pkg).serialNumber);
});
t("it is CycloneDX 1.5 with the package itself as the root component", () => {
  const s = buildSbom(lock, "packages/a", pkg);
  assert.equal(s.bomFormat, "CycloneDX"); assert.equal(s.specVersion, "1.5");
  assert.equal(s.metadata.component.purl, "pkg:npm/%40broberg/a@1.2.3");
});
t("the CLI is red for a directory that is not in the lockfile, and works on a real package", () => {
  const run = (d) => { try { execFileSync("node", ["scripts/gen-sbom.mjs", d], { stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
  assert.equal(run("packages/__nope__"), 1); assert.equal(run("packages/call"), 0);
});
console.log(`\n${n} passed`);

#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { offenders } from "./check-tarball-contents.mjs";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const f = (...p) => p.map((path) => ({ path, size: 1 }));

t("a normal package is clean", () => assert.deepEqual(offenders(f("package.json", "dist/index.js", "README.md", "LICENSE")), []));
t("env files, keys and credentials are caught", () => {
  for (const p of [".env", ".env.production", "config/.env.local", "server.pem", "tls/private.key", "id_rsa", "credentials.json", "secrets", ".npmrc", "data/app.sqlite", ".claude/settings.json", ".git/config"])
    assert.equal(offenders(f(p)).length, 1, p);
});
t("lookalikes that are NOT secrets pass (envelope.js, keyboard.js, monkey.ts)", () =>
  assert.deepEqual(offenders(f("dist/envelope.js", "dist/keyboard.js", "src/monkey.ts", "dist/environment.js")), []));
t("an oversized tarball is flagged", () => assert.equal(offenders(f("a.js"), 30 * 1024 * 1024).length, 1));
t("the CLI is red with no argument and on a package that does not exist", () => {
  const run = (...a) => { try { execFileSync("node", ["scripts/check-tarball-contents.mjs", ...a], { stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
  assert.equal(run(), 1); assert.equal(run("packages/__nope__"), 1);
});
t("the CLI is red on a real packed .env and green on a clean package", () => {
  const d = mkdtempSync(join(tmpdir(), "tar-")); const mk = (name, files) => { const p = join(d, name); mkdirSync(p); writeFileSync(join(p, "package.json"), JSON.stringify({ name: `@x/${name}`, version: "1.0.0" })); for (const [k, v] of Object.entries(files)) writeFileSync(join(p, k), v); return p; };
  const run = (p) => { try { execFileSync("node", [join(process.cwd(), "scripts/check-tarball-contents.mjs"), p], { stdio: "pipe" }); return 0; } catch (e) { return e.status; } };
  assert.equal(run(mk("clean", { "index.js": "1" })), 0);
  assert.equal(run(mk("hollow", {})), 1);
  assert.equal(run(mk("leaky", { "index.js": "1", ".env": "K=1" })), 1);
});
console.log(`\n${n} passed`);

// F090.6 — `secret-scan --stdin`, the door cardmem's fleet git gate (F036.23) calls.
// Asserts on the BUILT bin (dist/cli.js) — the file `npx secret-scan` actually runs.
// A missing dist is red, never a skip (F061.5).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const BIN = join(__dirname, "..", "dist", "cli.js");
const run = (input: string, args = ["--stdin"]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { input, encoding: "utf8" });
  return { code: r.status, err: r.stderr, out: r.stdout };
};
const pick = (alphabet: string, n: number) => Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join("");

describe("secret-scan --stdin", () => {
  it("is built and declared as the package bin", () => {
    expect(existsSync(BIN), "dist/cli.js missing — build first: pnpm --filter @broberg/secret-scan build").toBe(true);
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.bin).toEqual({ "secret-scan": "./dist/cli.js" });
    expect(readFileSync(BIN, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("exit 1 on a secret, names label + line, NEVER the value", () => {
    const key = `uk_${pick("0123456789abcdef", 48)}`;
    const r = run(`first line\nsecond\nUPMETRICS_API_KEY=${key}\n`);
    expect(r.code).toBe(1);
    expect(r.err).toContain("upmetrics-key line 3");
    expect(r.err + r.out).not.toContain(key);
    expect(r.err + r.out).not.toContain(key.slice(3, 15));
  });

  it("a multi-line secret (PEM) is still reported", () => {
    const body = Array.from({ length: 4 }, () => pick("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 64)).join("\n");
    const r = run(`-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`);
    expect(r.code).toBe(1);
    expect(r.err + r.out).not.toContain(body.split("\n")[1]);
  });

  it("exit 0 on clean text, with nothing printed", () => {
    const r = run("const x = 1;\nAuthorization: Bearer <token>\n");
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
  });

  it("exit 2 when it cannot scan (no --stdin)", () => {
    const r = run("", []);
    expect(r.code).toBe(2);
    expect(r.err).toContain("usage");
  });
});

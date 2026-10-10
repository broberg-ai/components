// F036.7 — the `testid-gaps <dir>` CLI that a CI gate runs (appkit #2487), with the
// contract cardmem set (#2489): file:line per gap and exit 1, exit 0 on a clean
// tree WITH the number of files scanned, and an error — never green — when zero
// files were scanned.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runTestidGaps } from "../src/cli";

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "f0367-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const write = (rel: string, body: string) => {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body);
};
function run(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runTestidGaps(args, (s) => out.push(s), (s) => err.push(s));
  return { code, out, err };
}

describe("F036.7 — testid-gaps <dir>", () => {
  test("gaps: exit 1, one file:line line per gap, and the totals", () => {
    write("src/a.tsx", '<div>\n  <button onClick={go}>Save</button>\n</div>\n');
    write("src/b.tsx", '<button data-testid="ok" onClick={go}>ok</button>\n');
    const r = run([root]);
    expect([r.code, r.out[0]?.startsWith("src/a.tsx:2  <button> without data-testid")]).toEqual([1, true]);
    expect(r.out.at(-1)).toBe("testid-gaps: 2 files scanned, 1 gaps in 1 files.");
  });

  test("clean tree: exit 0 and says how many files it read", () => {
    write("src/b.tsx", '<button data-testid="ok" onClick={go}>ok</button>\n');
    const r = run([root]);
    expect([r.code, r.out]).toEqual([0, ["testid-gaps: 1 files scanned, 0 gaps in 0 files."]]);
  });

  test("ZERO files scanned is an error, not green — a wrong path must not pass a gate", () => {
    write("README.md", "# nothing to scan\n");
    write("node_modules/x/index.tsx", "<button onClick={go}>skipped dir</button>\n");
    const r = run([root]);
    expect([r.code, r.err.at(-1)]).toEqual([2, `testid-gaps: 0 source files scanned under ${root} — refusing to report clean.`]);
  });

  test("not a directory, or no argument: exit 2", () => {
    expect([run([join(root, "nope")]).code, run([]).code, run([root, "extra"]).code]).toEqual([2, 2, 2]);
  });

  test("a file it cannot see into while it carries handlers is named on stderr, not counted clean silently", () => {
    write("popup.tsx", "export const P = () => h('button', { onClick: go }, 'Save');\n");
    write("ok.tsx", '<button data-testid="ok" onClick={go}>ok</button>\n');
    const r = run([root]);
    expect([r.code, r.err.some((l) => l.startsWith("popup.tsx  not examined"))]).toEqual([0, true]);
  });

  test("the BUILT bin returns the same exit codes to the shell (what CI actually sees)", () => {
    const bin = join(__dirname, "../dist/bin.js");
    write("src/a.tsx", "<button onClick={go}>Save</button>\n");
    const gaps = spawnSync(process.execPath, [bin, root], { encoding: "utf8" });
    rmSync(join(root, "src"), { recursive: true });
    write("src/b.tsx", '<button data-testid="ok" onClick={go}>ok</button>\n');
    const clean = spawnSync(process.execPath, [bin, root], { encoding: "utf8" });
    rmSync(join(root, "src"), { recursive: true });
    const empty = spawnSync(process.execPath, [bin, root], { encoding: "utf8" });
    expect([gaps.status, clean.status, empty.status]).toEqual([1, 0, 2]);
    expect(gaps.stdout).toContain("src/a.tsx:1  <button> without data-testid");
  });
});

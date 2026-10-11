// F001.26 — the changelog ships, and the version being published has an entry.
// Without this the next release goes out without one, exactly as ten did.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A path, not a URL: under jsdom, `URL` is jsdom's class and readFileSync refuses it.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const log = readFileSync(join(root, "CHANGELOG.md"), "utf8");

describe("CHANGELOG.md", () => {
  it("is in the published files", () => {
    expect(pkg.files).toContain("CHANGELOG.md");
  });
  it(`has an entry for the package's own version (${pkg.version})`, () => {
    expect(log).toMatch(new RegExp(`^## ${pkg.version.replace(/\./g, "\\.")} `, "m"));
  });
  it("every entry is marked", () => {
    const entries = log.split(/^## /m).slice(1);
    const unmarked = entries.filter((e) => !/BREAKING|OUTPUT CHANGED|ADDITIVE|never published|No code change/.test(e)).map((e) => e.split("\n")[0]);
    expect(unmarked).toEqual([]);
  });
});

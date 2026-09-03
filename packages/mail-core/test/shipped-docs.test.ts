import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** F023.11 AC#3 — a warning that does not ship is not a warning.
 *
 *  `tsup`/`tsc` emit declarations for EXPORTS only, so a docstring on a
 *  non-exported symbol is stripped from dist/*.d.ts while it stays perfect in
 *  src/ and every test stays green. This package's sibling @broberg/mail was
 *  bitten by exactly that: the one line stopping a repo from reading a message
 *  status as a recipient status vanished from the published types because a
 *  non-exported const was inserted between the comment and its export.
 *
 *  Only a test that reads the BUILT file can see it. */
const DTS = resolve(__dirname, "../dist/index.d.ts");

describe("the load-bearing warnings reach the published types", () => {
  it("dist/index.d.ts exists — the gate builds before it tests", () => {
    // turbo's test task dependsOn build. If this fails, the assertions below
    // would be skipping silently rather than passing.
    expect(existsSync(DTS)).toBe(true);
  });

  const required: Array<[string, string]> = [
    ["fill escapes", "Every value is HTML-escaped"],
    ["the ordering rule", "RENDER FIRST, THEN FILL"],
    ["fillHtml is the raw one", "raw HTML"],
    // First needle here was "inject markup into the mail" — which lives in the
    // runtime ERROR STRING, in the function body, and never reaches a .d.ts.
    // The test correctly failed, and the distinction it drew is the one it
    // exists for: "somewhere in the source" is not "in the published types".
    ["brand values are rejected, not escaped", "REJECT, never escape"],
  ];
  for (const [what, sentence] of required) {
    it(`${what}: "${sentence}"`, () => {
      expect(readFileSync(DTS, "utf8")).toContain(sentence);
    });
  }

  it("NEGATIVE CONTROL: a sentence that is NOT in the source is not found", () => {
    // Without this, a bug that made the read return the whole repo — or a
    // toContain against an empty needle — would pass every assertion above.
    expect(readFileSync(DTS, "utf8")).not.toContain("this sentence appears nowhere in the package");
  });
});

// F001.14 — a CORRECT alias was emitted as a literal brace string.
//
// Reported by cardmem against a clean 0.5.0 install, and it is the follow-up
// F001.12 explicitly deferred and then did not card. Their phrasing is the one
// worth keeping: the INVALID case shouts and the VALID one is silent. It is
// harder to spot than the bug it succeeded, because the input is right.
//
// PROVEN RED AGAINST PUBLISHED 0.5.0 BEFORE ANY OF THIS WAS WRITTEN:
//   generateTailwindV4  ->  "--a: {colors.ink};"
//   checkContrastAA     ->  TypeError: Cannot read properties of undefined (reading 'r')
import { describe, expect, it } from "vitest";
import { checkContrastAA, generateTailwindV4 } from "../src/design-md.js";

const md = (yaml: string): string => `---\n${yaml}\n---\n`;
const rootLine = (css: string, prop: string): string | undefined =>
  css.split("\n").map((l) => l.trim()).find((l) => l.startsWith(`${prop}:`));

describe("an alias is substituted, not echoed", () => {
  it("emits the VALUE the alias names", () => {
    const { css } = generateTailwindV4(
      md(`colors:\n  ink: "#101010"\n  a: "{colors.ink}"`),
      { tailwindImport: false },
    );
    expect(rootLine(css, "--a")).toBe("--a: #101010;");
    // And nothing anywhere still carries the reference syntax.
    expect(css).not.toContain("{colors.");
  });

  it("resolves a CHAIN, and every link emits the final value", () => {
    const { css } = generateTailwindV4(
      md(`colors:\n  c: "#0a0a0a"\n  b: "{colors.c}"\n  a: "{colors.b}"`),
      { tailwindImport: false },
    );
    // Asserted per token, not only on the last one — a chain that resolves the
    // tail and leaves the middle alone would pass a last-link-only check.
    expect(rootLine(css, "--a")).toBe("--a: #0a0a0a;");
    expect(rootLine(css, "--b")).toBe("--b: #0a0a0a;");
    expect(rootLine(css, "--c")).toBe("--c: #0a0a0a;");
  });

  it("substitutes in rounded, spacing and typography too, not only colours", () => {
    const { css } = generateTailwindV4(
      md(
        `rounded:\n  base: "8px"\n  lg: "{rounded.base}"\n` +
          `spacing:\n  unit: "4px"\n  gap: "{spacing.unit}"\n` +
          `typography:\n  body:\n    fontSize: "1rem"\n  lead:\n    fontSize: "{typography.body.fontSize}"`,
      ),
      { tailwindImport: false },
    );
    expect(rootLine(css, "--radius-lg")).toBe("--radius-lg: 8px;");
    expect(rootLine(css, "--spacing-gap")).toBe("--spacing-gap: 4px;");
    expect(rootLine(css, "--text-lead")).toBe("--text-lead: 1rem;");
  });
});

describe("a cycle is refused BY NAME, never by dying", () => {
  it("names both tokens in a two-step loop", () => {
    const run = () =>
      generateTailwindV4(md(`colors:\n  a: "{colors.b}"\n  b: "{colors.a}"`), { tailwindImport: false });
    expect(run).toThrow(/alias cycle/);
    expect(run).toThrow(/\{colors\.b\}/);
    expect(run).toThrow(/\{colors\.a\}/);
    // Not a stack overflow — somebody else's error in place of ours is the
    // failure this whole function exists to remove.
    expect(run).not.toThrow(RangeError);
  });

  it("refuses a self-reference", () => {
    expect(() => generateTailwindV4(md(`colors:\n  a: "{colors.a}"`), { tailwindImport: false })).toThrow(
      /alias cycle/,
    );
  });
});

describe("the 0.5.0 refusals are unchanged — negative controls", () => {
  // Without these the fix could pass by loosening validation, which would be a
  // worse package that happens to satisfy the new tests.
  it("an alias naming nothing still fails, with the same message", () => {
    expect(() => generateTailwindV4(md(`colors:\n  a: "{colors.missing}"`), { tailwindImport: false })).toThrow(
      /references \{colors\.missing\}, which is not defined in this file/,
    );
  });

  it("an unparseable colour still fails, naming the token", () => {
    expect(() => generateTailwindV4(md(`colors:\n  a: "#ZZZZZZ"`), { tailwindImport: false })).toThrow(
      /colors\.a is "#ZZZZZZ", which is not a colour/,
    );
  });

  it("an alias that resolves to a NON-colour is refused by name, not emitted", () => {
    // Validation runs on the RESOLVED value, so this is caught by the colour
    // check rather than by a separate cross-kind rule. Refused, not silently
    // emitted — which would be a new success-shaped non-answer.
    expect(() =>
      generateTailwindV4(md(`rounded:\n  lg: "12px"\ncolors:\n  a: "{rounded.lg}"`), { tailwindImport: false }),
    ).toThrow(/colors\.a is "12px", which is not a colour/);
  });
});

describe("the contrast checker measures the RESOLVED colour", () => {
  it("does not throw culori's TypeError on a valid alias", () => {
    // Measured on published 0.5.0: this exact input threw
    // "Cannot read properties of undefined (reading 'r')" from culori — the
    // crash F001.12 removed for an unparseable colour and left reachable
    // through the input a real DESIGN.md actually contains.
    const content = md(`colors:\n  ink: "#101010"\n  background: "#111111"\n  foreground: "{colors.ink}"`);
    expect(() => checkContrastAA(content)).not.toThrow();
  });

  it("REPORTS a real failure that is only visible after resolving", () => {
    // #101010 on #111111 is ~1.02:1. If the alias were skipped rather than
    // resolved, this pair would simply not be measured and the test above would
    // pass on a checker that had stopped checking.
    const content = md(`colors:\n  ink: "#101010"\n  background: "#111111"\n  foreground: "{colors.ink}"`);
    const issues = checkContrastAA(content);
    expect(issues.some((i) => i.foreground === "foreground" && i.background === "background")).toBe(true);
  });

  it("a resolved PASS is still a pass", () => {
    const content = md(`colors:\n  ink: "#ffffff"\n  background: "#101010"\n  foreground: "{colors.ink}"`);
    expect(checkContrastAA(content)).toEqual([]);
  });
});

// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDesignMd, designMdToTailwindV4, checkContrastAA, generateTailwindV4 } from "../src/design-md";

const here = dirname(fileURLToPath(import.meta.url));
const DESIGN_MD = readFileSync(join(here, "..", "DESIGN.md"), "utf8");

describe("design-md generator", () => {
  it("parses front matter into tokens + body", () => {
    const { tokens, body } = parseDesignMd(DESIGN_MD);
    expect(tokens.colors?.primary).toBe("oklch(0.922 0 0)");
    expect(tokens.rounded?.lg).toBe("0.5rem");
    expect(body).toContain("## Overview");
  });

  it("throws on a DESIGN.md without front matter", () => {
    expect(() => parseDesignMd("# no front matter")).toThrow(/front matter/);
  });

  it("generates a Tailwind v4 :root + @theme bridge", () => {
    const css = designMdToTailwindV4(DESIGN_MD);
    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain(":root {");
    expect(css).toContain("--background: oklch(0.211 0 0);");
    expect(css).toContain("--primary: oklch(0.922 0 0);");
    expect(css).toContain("@theme inline {");
    // F001.11 — THIS TEST USED TO REQUIRE THE DEFECT. The three lines below read
    // `var(--radius-lg)` etc., i.e. a property whose value is itself, and this
    // assertion is what kept them there: the bug was not merely uncaught, it was
    // pinned. Colours keep the indirection because their raw name DIFFERS and
    // because data-theme swaps them; the other three carry their value.
    expect(css).toContain("--color-primary: var(--primary);");
    expect(css).toContain("--radius-lg: 0.5rem;");
    expect(css).toContain("--spacing-md: 16px;");
    expect(css).toContain("--text-headline-lg: 2rem;");
  });

  it("emits breakpoint tokens in @theme and the touch-target var in :root", () => {
    const { tokens } = parseDesignMd(DESIGN_MD);
    expect(tokens.breakpoints?.md).toBe("768px");
    expect(tokens.touch?.["target-min"]).toBe("44px");
    const css = designMdToTailwindV4(DESIGN_MD);
    expect(css).toContain("--breakpoint-sm: 640px;");
    expect(css).toContain("--breakpoint-xl: 1280px;");
    expect(css).toContain("--touch-target-min: 44px;");
  });

  it("round-trips the neutral preset's base color tokens", () => {
    const { tokens } = parseDesignMd(DESIGN_MD);
    const css = designMdToTailwindV4(DESIGN_MD);
    for (const [name, value] of Object.entries(tokens.colors ?? {})) {
      expect(css).toContain(`--${name}: ${value};`);
      expect(css).toContain(`--color-${name}: var(--${name});`);
    }
  });

  it("the neutral preset passes WCAG-AA contrast", () => {
    expect(checkContrastAA(DESIGN_MD)).toEqual([]);
  });

  it("flags a failing contrast pair", () => {
    const bad = [
      "---",
      "colors:",
      '  background: "#ffffff"',
      '  foreground: "#bbbbbb"',
      "---",
      "## Overview",
    ].join("\n");
    const issues = checkContrastAA(bad);
    expect(issues).toHaveLength(1);
    expect(issues[0].foreground).toBe("foreground");
    expect(issues[0].ratio).toBeLessThan(4.5);
  });
});

// ---------------------------------------------------------------------------
// F001.11 — the bridge that pointed at itself.
//
// These are STRUCTURAL, not string-comparing, on purpose. F001.8's completion
// note said "round-trip vs neutral-preset.css verified EXACT" — and it was, and
// it was green through every defect below, because it compared our generator's
// output to a file written in the same shape. A test that asks "does the
// generator produce the string we expect?" cannot see any of this. One that asks
// "would a browser resolve these?" sees all of it.
// ---------------------------------------------------------------------------
describe("F001.11 — the @theme bridge", () => {
  const DOC = `---
colors:
  ivory: "#FFFFF0"
rounded:
  DEFAULT: "8px"
  lg: "12px"
spacing:
  gutter: 16
typography:
  body:
    fontFamily: "Inter"
    fontSize: "16px"
    lineHeight: 1.5
shadow:
  card: "0 1px 2px rgba(0,0,0,.1)"
motion:
  fast: "120ms"
---
body`;

  /** Every `--x: ...;` inside the @theme block, as [name, value]. */
  function themeDecls(css: string): Array<[string, string]> {
    const block = css.slice(css.indexOf("@theme inline {"));
    return [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
  }
  function rootNames(css: string): Set<string> {
    const block = css.slice(css.indexOf("{"), css.indexOf("@theme inline {"));
    return new Set([...block.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
  }

  it("emits no property that references ITSELF", () => {
    // Measured against tailwindcss 4.3.3: Tailwind really does put this line in
    // its compiled @layer theme, and `--x: var(--x)` has no computed value. It
    // REPLACED a working stock default (--radius-lg: 0.5rem) with nothing.
    const offenders = themeDecls(designMdToTailwindV4(DOC)).filter(([n, v]) => v === `var(${n})`);
    expect(offenders).toEqual([]);
  });

  it("every var() in the bridge points at a DIFFERENT name that is declared", () => {
    // The invariant. The test above is the special case that actually bit us —
    // this one also catches a reference to a name nobody declares.
    const css = designMdToTailwindV4(DOC);
    const declared = rootNames(css);
    for (const [name, value] of themeDecls(css)) {
      const ref = /^var\((--[\w-]+)\)$/.exec(value);
      if (!ref) continue;
      expect(ref[1]).not.toBe(name);
      expect(declared.has(ref[1])).toBe(true);
    }
  });

  it("DEFAULT becomes the BARE namespace name, in every namespace", () => {
    // rounded.DEFAULT used to emit --radius-DEFAULT. cardmem measured 30 uses of
    // border-radius: var(--radius) with nothing behind them.
    const css = designMdToTailwindV4(DOC);
    expect(css).toContain("--radius: 8px;");
    expect(css).not.toContain("--radius-DEFAULT");
    // Asserted per namespace, because fixing only radius is how the
    // three-namespace version of the self-reference happened in the first place.
    const withDefaults = designMdToTailwindV4(
      `---\ncolors:\n  DEFAULT: "#111"\nspacing:\n  DEFAULT: "4px"\ntypography:\n  DEFAULT:\n    fontSize: "14px"\n---\nb`,
    );
    for (const n of ["--color", "--spacing", "--text"]) {
      expect(withDefaults).toContain(`${n}: `);
      expect(withDefaults).not.toContain(`${n}-DEFAULT`);
    }
  });

  it("reports what it could not convert, by NAME", () => {
    // 58 of 72 tokens vanished from cardmem's file through a build that reported
    // success. A count would not have helped them; the names do.
    const { skipped } = generateTailwindV4(DOC);
    const names = skipped.map((s) => s.namespace);
    expect(names).toContain("shadow");
    expect(names).toContain("motion");
    expect(names.some((n) => n.startsWith("typography"))).toBe(true);
    for (const s of skipped) expect(s.reason.length).toBeGreaterThan(0);
  });

  it("says nothing was skipped when nothing was", () => {
    // The negative control. Without it the previous test passes on a generator
    // that reports every namespace as skipped, always.
    const { skipped } = generateTailwindV4(`---\ncolors:\n  ink: "#000"\n---\nb`);
    expect(skipped).toEqual([]);
  });

  it("can omit the tailwindcss import", () => {
    expect(designMdToTailwindV4(DOC)).toContain('@import "tailwindcss";');
    expect(designMdToTailwindV4(DOC, { tailwindImport: false })).not.toContain("@import");
  });

  it("holds under a non-:root selector — the case that actually broke", () => {
    // With selector:".brand" there is no unlayered :root left to save a
    // self-reference, so outside .brand every radius/spacing/text utility
    // resolved to nothing. Compiled with tailwindcss 4.3.3 before and after:
    //   before  @layer theme { :root,:host { --radius-lg: var(--radius-lg) } }
    //   after   @layer theme { :root,:host { --radius-lg: 12px } }
    const css = designMdToTailwindV4(DOC, { selector: ".brand" });
    expect(css).toContain(".brand {");
    expect(themeDecls(css).filter(([n, v]) => v === `var(${n})`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F001.12 — the generator used to check nothing.
//
// Until 0.5.0 it threw on missing YAML front matter and on NOTHING else, so
// "the generator ran" and "the generator checked nothing" were the same
// observation (cardmem's phrasing, and it was exact).
// ---------------------------------------------------------------------------
describe("F001.12 — what the generator refuses", () => {
  const doc = (body: string) => `---\n${body}\n---\nb`;

  it("refuses a colour no colour engine can read", () => {
    expect(() => designMdToTailwindV4(doc('colors:\n  brand: "#ZZZZZZ"'))).toThrow(/colors\.brand/);
    expect(() => designMdToTailwindV4(doc('colors:\n  brand: "#ZZZZZZ"'))).toThrow(/not a colour/);
  });

  it("refuses an alias naming a token that does not exist", () => {
    // The worse of the two: {colors.missing} is DESIGN.md's OWN reference
    // syntax, and it used to land in the CSS as a literal string. It does not
    // look like corruption; it looks deliberate.
    expect(() => designMdToTailwindV4(doc('colors:\n  a: "{colors.missing}"'))).toThrow(/\{colors\.missing\}/);
  });

  it("ACCEPTS an alias that DOES resolve", () => {
    // The negative control. Without it, the test above passes on a generator
    // that refuses every alias, which would break the syntax entirely.
    const css = designMdToTailwindV4(doc('colors:\n  ink: "#112233"\n  body: "{colors.ink}"'));
    expect(css).toContain("--body: {colors.ink};");
  });

  it("checks aliases in EVERY namespace, not only colours", () => {
    // An alias is DESIGN.md syntax, not a colour feature. Fixing only the
    // namespace that was reported is exactly how F001.11's three-namespace
    // self-reference survived.
    expect(() => designMdToTailwindV4(doc('rounded:\n  lg: "{rounded.nope}"'))).toThrow(/rounded\.lg/);
    expect(() => designMdToTailwindV4(doc('spacing:\n  md: "{spacing.nope}"'))).toThrow(/spacing\.md/);
    expect(() =>
      designMdToTailwindV4(doc("typography:\n  body:\n    fontSize: \"{typography.nope}\"")),
    ).toThrow(/typography\.body\.fontSize/);
  });

  it("does NOT refuse a length it merely does not recognise", () => {
    // Deliberate. There is no reliable oracle for a CSS length: clamp(), calc(),
    // min(), a bare var(), and units a regex will not know next year. A
    // generator that refuses valid CSS is worse than one that passes an odd
    // string through — a refusal blocks a build, a passed-through string is
    // visible in the output and ignored by the browser.
    for (const v of ["clamp(4px,1vw,12px)", "calc(var(--r) * 2)", "min(2rem, 5%)", "var(--x)"]) {
      expect(() => designMdToTailwindV4(doc(`rounded:\n  lg: "${v}"`))).not.toThrow();
    }
  });

  it("checkContrastAA names the token instead of leaking culori's TypeError", () => {
    // I had this BACKWARDS before measuring: I assumed an unreadable colour
    // would return [] — a silent pass, because that is this week's pattern.
    // It crashed instead, from inside a dependency, with "undefined is not an
    // object (evaluating 'c.r')". Wrong in the other direction, still wrong.
    const pair = (fg: string) => doc(`colors:\n  foreground: "${fg}"\n  background: "#FFFFFF"`);
    expect(() => checkContrastAA(pair("#ZZZZZZ"))).toThrow(/colors\.foreground/);
    // BOTH cases. assertColour deliberately skips an alias, so wiring only that
    // one in left this path leaking the TypeError — my own fix had the same
    // shape as the defect, and only asserting both cases caught it.
    expect(() => checkContrastAA(pair("{colors.missing}"))).toThrow(/colors\.foreground/);
    expect(() => checkContrastAA(pair("{colors.missing}"))).not.toThrow(/c\.r/);
  });

  it("still reports a REAL contrast failure, and still passes a real pass", () => {
    // The fix must not turn the checker into something that only ever complains.
    const pair = (fg: string) => doc(`colors:\n  foreground: "${fg}"\n  background: "#FFFFFF"`);
    expect(checkContrastAA(pair("#777777"))).toHaveLength(1);
    expect(checkContrastAA(pair("#000000"))).toEqual([]);
  });
});

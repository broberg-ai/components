// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDesignMd, designMdToTailwindV4, checkContrastAA } from "../src/design-md";

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
    expect(css).toContain("--color-primary: var(--primary);");
    expect(css).toContain("--radius-lg: var(--radius-lg);");
    expect(css).toContain("--spacing-md: var(--spacing-md);");
    expect(css).toContain("--text-headline-lg: var(--text-headline-lg);");
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

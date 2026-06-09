/**
 * @broberg/theme/design-md — DESIGN.md → Tailwind v4 generator + WCAG-AA check.
 *
 * DESIGN.md (Google Labs, Apache-2.0) is the agent-readable design contract:
 * YAML token front matter + markdown prose. Its official CLI (`@google/design.md
 * export`) emits Tailwind **v3** (`tailwind.config.js`) + W3C DTCG only — there is
 * NO Tailwind v4 path. This fills that gap: it converts a DESIGN.md's YAML tokens
 * into a Tailwind v4 `@theme inline` CSS baseline (the shape neutral-preset.css
 * uses), and validates WCAG-AA contrast.
 *
 * Scope note: DESIGN.md models ONE token set (a single theme). The multi-variant
 * data-theme system (light/dark/warm/cool) is @broberg/theme's extension on top —
 * a generated baseline covers the `:root` theme; variants stay package-owned.
 */
import { parse as parseYaml } from "yaml";
import { wcagContrast } from "culori";

export interface TypographyToken {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: number;
  lineHeight?: string | number;
  letterSpacing?: string;
  fontFeature?: string;
  fontVariation?: string;
}

export interface DesignTokens {
  colors?: Record<string, string>;
  typography?: Record<string, TypographyToken>;
  rounded?: Record<string, string>;
  spacing?: Record<string, string | number>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ParsedDesignMd {
  tokens: DesignTokens;
  body: string;
}

const FRONT_MATTER = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

/** Split a DESIGN.md into its YAML token front matter and the markdown body. */
export function parseDesignMd(content: string): ParsedDesignMd {
  const match = content.match(FRONT_MATTER);
  if (!match) {
    throw new Error("DESIGN.md: missing YAML front matter (expected leading --- fences).");
  }
  const tokens = (parseYaml(match[1]) as DesignTokens) ?? {};
  return { tokens, body: match[2] ?? "" };
}

export interface GenerateV4Options {
  /** CSS selector the raw token vars are declared under. Default ":root". */
  selector?: string;
}

/**
 * Convert a DESIGN.md into a Tailwind v4 baseline: a `:root` block of raw token
 * custom properties + an `@theme inline` bridge mapping them into Tailwind's
 * utility namespaces (`--color-*`, `--radius-*`, `--spacing-*`, `--text-*`).
 */
export function designMdToTailwindV4(content: string, options: GenerateV4Options = {}): string {
  const { tokens } = parseDesignMd(content);
  const selector = options.selector ?? ":root";
  const root: string[] = [];
  const theme: string[] = [];

  for (const [name, value] of Object.entries(tokens.colors ?? {})) {
    root.push(`  --${name}: ${value};`);
    theme.push(`  --color-${name}: var(--${name});`);
  }
  for (const [name, value] of Object.entries(tokens.rounded ?? {})) {
    root.push(`  --radius-${name}: ${value};`);
    theme.push(`  --radius-${name}: var(--radius-${name});`);
  }
  for (const [name, value] of Object.entries(tokens.spacing ?? {})) {
    const v = typeof value === "number" ? `${value}px` : value;
    root.push(`  --spacing-${name}: ${v};`);
    theme.push(`  --spacing-${name}: var(--spacing-${name});`);
  }
  for (const [name, token] of Object.entries(tokens.typography ?? {})) {
    if (token.fontSize) {
      root.push(`  --text-${name}: ${token.fontSize};`);
      theme.push(`  --text-${name}: var(--text-${name});`);
    }
  }

  return [
    "/* Generated from DESIGN.md by @broberg/theme/design-md — Tailwind v4. Do not edit by hand. */",
    '@import "tailwindcss";',
    "",
    `${selector} {`,
    ...root,
    "}",
    "",
    "@theme inline {",
    ...theme,
    "}",
    "",
  ].join("\n");
}

export interface ContrastIssue {
  foreground: string;
  background: string;
  ratio: number;
  required: number;
}

const CONTRAST_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["on-surface", "surface"],
  ["foreground", "background"],
  ["primary-foreground", "primary"],
  ["card-foreground", "card"],
];

/**
 * Check WCAG-AA (4.5:1) contrast for the key foreground/background color pairs in
 * a DESIGN.md. Returns the pairs that FAIL (empty array = all good). Handles hex,
 * oklch, hsl — any CSS color culori can parse.
 */
export function checkContrastAA(content: string, required = 4.5): ContrastIssue[] {
  const { tokens } = parseDesignMd(content);
  const colors = tokens.colors ?? {};
  const issues: ContrastIssue[] = [];
  for (const [fg, bg] of CONTRAST_PAIRS) {
    if (colors[fg] && colors[bg]) {
      const ratio = wcagContrast(colors[fg], colors[bg]);
      if (typeof ratio === "number" && Number.isFinite(ratio) && ratio < required) {
        issues.push({
          foreground: fg,
          background: bg,
          ratio: Math.round(ratio * 100) / 100,
          required,
        });
      }
    }
  }
  return issues;
}

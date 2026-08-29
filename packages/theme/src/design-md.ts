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
  breakpoints?: Record<string, string>;
  touch?: Record<string, string>;
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
  /**
   * Emit `@import "tailwindcss";` at the top. Default true.
   *
   * F001.11 — a consumer whose entry CSS already imports Tailwind had to strip
   * this line by hand every time the file was regenerated, which is the kind of
   * manual step that survives exactly until somebody forgets it.
   */
  tailwindImport?: boolean;
}

/** A DESIGN.md namespace this generator does not emit, and why. */
export interface SkippedNamespace {
  namespace: string;
  count: number;
  reason: string;
}

export interface GenerateV4Result {
  css: string;
  /**
   * Namespaces present in the DESIGN.md that produced NO output.
   *
   * F001.11 — these used to be discarded in silence. cardmem measured 58 of 72
   * tokens vanishing from their file through a build that reported success: a
   * generator that drops the majority of its input and exits 0 tells the caller
   * the same thing as one that handled everything.
   */
  skipped: SkippedNamespace[];
}

/** DESIGN.md keys this generator emits. Anything else is reported as skipped. */
const HANDLED = new Set(["colors", "typography", "rounded", "spacing", "breakpoints", "touch", "components"]);

/**
 * Tailwind reads `DEFAULT` as THE BARE NAMESPACE NAME, not a suffix.
 *
 * F001.11 — `rounded: { DEFAULT: "8px" }` used to emit `--radius-DEFAULT`, and
 * cardmem measured 30 uses of `border-radius: var(--radius)` with nothing behind
 * them: square corners on modals, cards and inputs, and a bare `.rounded` falling
 * back to Tailwind's 0.25rem. `vite build` said nothing.
 */
function themeVar(namespace: string, name: string): string {
  return name === "DEFAULT" ? `--${namespace}` : `--${namespace}-${name}`;
}

/**
 * Convert a DESIGN.md into a Tailwind v4 baseline: a `:root` block of raw token
 * custom properties + an `@theme inline` bridge mapping them into Tailwind's
 * utility namespaces (`--color-*`, `--radius-*`, `--spacing-*`, `--text-*`).
 *
 * F001.11 — WHY THE BRIDGE DOES NOT SAY `var()` FOR EVERY NAMESPACE.
 *
 * It used to emit BOTH `:root{--radius-lg:12px}` and
 * `@theme inline{--radius-lg:var(--radius-lg)}` — the same name on both sides.
 * Tailwind really does put that second line in the compiled output, inside its
 * own `@layer theme`, and a custom property whose value is `var(--itself)` has
 * no computed value at all. Measured against tailwindcss 4.3.3:
 *
 *   stock Tailwind    @layer theme { :root,:host { --radius-lg: 0.5rem } }
 *   with our block    @layer theme { :root,:host { --radius-lg: var(--radius-lg) } }
 *
 * So the generator REPLACED a working default with something empty. With the
 * default `selector: ":root"` our own unlayered `:root{--radius-lg:12px}` won
 * anyway (unlayered beats any layer), which is why nobody saw it — the
 * correctness rested entirely on that. Pass `selector: ".brand"`, a documented
 * option of this very function, and there is no unlayered `:root` left: outside
 * `.brand` every radius/spacing/text utility resolved to NOTHING, where stock
 * Tailwind would have given 0.5rem.
 *
 * Colours were never affected, because their raw name differs from their theme
 * name (`--ivory` -> `--color-ivory`). That asymmetry is precisely why this
 * survived review: the one namespace anyone would spot-check by eye is the
 * correct one.
 *
 * THE FIX IS NOT A RENAME. Renaming the raw tokens would break every consumer
 * writing `var(--radius-lg)` in plain CSS today. Instead the three colliding
 * namespaces emit their VALUE into `@theme`, and only colours keep the `var()`
 * indirection. The cost of inlining is that a utility no longer FOLLOWS the raw
 * variable at runtime — and that cost was measured before it was accepted: in
 * css/neutral-preset.css, ZERO of the `data-theme` variants redefine a radius,
 * spacing or text token. Only colours vary per theme, and colours keep `var()`.
 */
export function designMdToTailwindV4(content: string, options: GenerateV4Options = {}): string {
  return generateTailwindV4(content, options).css;
}

/**
 * The same conversion, plus what it could NOT convert.
 *
 * `designMdToTailwindV4` keeps its string return for existing callers; this is
 * the entry that can answer "did you actually use my file?".
 */
export function generateTailwindV4(content: string, options: GenerateV4Options = {}): GenerateV4Result {
  const { tokens } = parseDesignMd(content);
  const selector = options.selector ?? ":root";
  const root: string[] = [];
  const theme: string[] = [];
  const skipped: SkippedNamespace[] = [];

  for (const [name, value] of Object.entries(tokens.colors ?? {})) {
    // The one namespace where raw and theme names differ, so `var()` is safe —
    // and the one where it EARNS its keep, since data-theme swaps colours.
    root.push(`  --${name}: ${value};`);
    theme.push(`  ${themeVar("color", name)}: var(--${name});`);
  }
  for (const [name, value] of Object.entries(tokens.rounded ?? {})) {
    root.push(`  ${themeVar("radius", name)}: ${value};`);
    theme.push(`  ${themeVar("radius", name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(tokens.spacing ?? {})) {
    const v = typeof value === "number" ? `${value}px` : value;
    root.push(`  ${themeVar("spacing", name)}: ${v};`);
    theme.push(`  ${themeVar("spacing", name)}: ${v};`);
  }
  for (const [name, token] of Object.entries(tokens.typography ?? {})) {
    if (token.fontSize) {
      root.push(`  ${themeVar("text", name)}: ${token.fontSize};`);
      theme.push(`  ${themeVar("text", name)}: ${token.fontSize};`);
    }
  }
  // Breakpoints live directly in @theme (Tailwind v4 reads --breakpoint-* there).
  for (const [name, value] of Object.entries(tokens.breakpoints ?? {})) {
    theme.push(`  ${themeVar("breakpoint", name)}: ${value};`);
  }
  // Touch-target has no Tailwind namespace — a plain custom property in :root.
  for (const [name, value] of Object.entries(tokens.touch ?? {})) {
    root.push(`  --touch-${name}: ${value};`);
  }

  // WHAT WE DID NOT EMIT, said out loud. See GenerateV4Result.skipped.
  const typographyExtras = Object.values(tokens.typography ?? {}).filter(
    (t) => t.fontFamily || t.fontWeight || t.lineHeight || t.letterSpacing || t.fontFeature || t.fontVariation,
  ).length;
  if (typographyExtras) {
    skipped.push({
      namespace: "typography (fontFamily/fontWeight/lineHeight/letterSpacing)",
      count: typographyExtras,
      reason: "only fontSize is bridged; the rest have no single Tailwind namespace and are not emitted",
    });
  }
  for (const [key, value] of Object.entries(tokens)) {
    if (HANDLED.has(key)) continue;
    const count = value && typeof value === "object" ? Object.keys(value as object).length : 1;
    skipped.push({ namespace: key, count, reason: "not a namespace this generator bridges" });
  }

  const css = [
    "/* Generated from DESIGN.md by @broberg/theme/design-md — Tailwind v4. Do not edit by hand. */",
    ...(options.tailwindImport === false ? [] : ['@import "tailwindcss";']),
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

  return { css, skipped };
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

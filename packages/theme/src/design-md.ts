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
import { wcagContrast, parse as parseColor } from "culori";

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
 * F001.12 — WHAT THE GENERATOR REFUSES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * Until 0.5.0 it threw on missing YAML front matter and on NOTHING else, so
 * "the generator ran" and "the generator checked nothing" were the same
 * observation. cardmem's phrasing, and it was exact — measured on 0.4.0:
 *
 *   colors.brand "#ZZZZZZ"           ->  --brand: #ZZZZZZ;
 *   colors.alias "{colors.missing}"  ->  --alias: {colors.missing};
 *
 * The alias is the worse of the two. `{colors.missing}` is DESIGN.md's OWN
 * reference syntax naming a token that does not exist, and it landed in the CSS
 * as a literal string. It does not look like corruption; it looks deliberate.
 *
 * LENGTHS ARE NOT VALIDATED, on purpose. There is no reliable oracle: CSS
 * accepts clamp(), calc(), min(), a bare var(), and units a regex will not
 * know next year. A generator that refuses valid CSS is worse than one that
 * passes an odd string through, and the failure mode is opposite — a refusal
 * blocks a build, a passed-through string is visible in the output and ignored
 * by the browser. Colours get checked because culori is a real oracle for them.
 */
const ALIAS = /^\{([\w.-]+)\}$/;

/** Walk a dotted DESIGN.md path (`colors.ink`) against the parsed tokens. */
function resolvePath(tokens: DesignTokens, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object" && key in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, tokens);
}

/**
 * Resolve `{namespace.name}` to the value it names, transitively.
 *
 * F001.14 — until 0.6.0 this only VALIDATED. A correct alias was checked, found
 * to resolve, and then emitted verbatim:
 *
 *   colors.a: "{colors.ink}"   ->   --a: {colors.ink};
 *
 * cardmem's phrasing is the one that makes it worth its own release: the INVALID
 * case shouted and the VALID one was silent. It is harder to spot than the bug
 * it succeeded, because the input is RIGHT — nobody debugging starts with the
 * token they wrote correctly.
 *
 * MEASURED ON 0.5.0, and the second half was worse than the report. The same
 * alias through `checkContrastAA`:
 *
 *   TypeError: Cannot read properties of undefined (reading 'r')
 *
 * — culori's stack again, from the checker F001.12 was written to stop leaking
 * it. That fix removed the crash for an UNPARSEABLE colour and left it fully
 * reachable through a VALID alias, which is the input a real DESIGN.md contains.
 *
 * A CYCLE IS REFUSED BY NAME, never by recursing until the stack dies: a stack
 * overflow is somebody else's error text in place of ours, which is the exact
 * failure this function is here to remove.
 */
function resolveAlias(tokens: DesignTokens, where: string, value: string): string {
  let current = String(value).trim();
  const chain: string[] = [];
  for (;;) {
    const m = ALIAS.exec(current);
    if (!m) return current;
    const path = m[1]!;
    if (chain.includes(path)) {
      throw new Error(
        `DESIGN.md: ${where} is part of an alias cycle — ${[...chain, path].map((p) => `{${p}}`).join(" -> ")}. ` +
          `Resolving it would never terminate, so nothing is emitted.`,
      );
    }
    chain.push(path);
    const next = resolvePath(tokens, path);
    // Message kept BYTE-IDENTICAL to 0.5.0's on purpose: it is a negative
    // control for this change, and a consumer may already grep for it.
    if (next === undefined) {
      throw new Error(
        `DESIGN.md: ${where} references {${path}}, which is not defined in this file. ` +
          `Emitting it would put the literal string "{${path}}" into your CSS, where it looks deliberate and does nothing.`,
      );
    }
    current = String(next).trim();
  }
}

/** Refuse a colour no colour engine can read. culori is the oracle. */
function assertColour(where: string, value: string): void {
  // UNREACHABLE FROM BOTH CALLERS SINCE 0.6.0, and recorded as unreachable
  // rather than deleted: generateTailwindV4 and checkContrastAA now resolve
  // aliases before calling this, so no brace string reaches it. Removing it
  // would be safe today and would silently become a hole the moment a third
  // caller passes a raw token value. Deleting a guard to find out whether it
  // was load-bearing is how the emptiness gets discovered the expensive way.
  if (ALIAS.test(String(value).trim())) return;
  if (parseColor(String(value)) === undefined) {
    throw new Error(
      `DESIGN.md: ${where} is ${JSON.stringify(value)}, which is not a colour. ` +
        `It would be emitted as a custom property the browser silently discards, and the contrast check cannot read it either.`,
    );
  }
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
    const v = resolveAlias(tokens, `colors.${name}`, String(value));
    // Validated AFTER resolution, so an alias pointing at something that is not
    // a colour is refused by name instead of emitted.
    assertColour(`colors.${name}`, v);
    // The one namespace where raw and theme names differ, so `var()` is safe —
    // and the one where it EARNS its keep, since data-theme swaps colours.
    root.push(`  --${name}: ${v};`);
    theme.push(`  ${themeVar("color", name)}: var(--${name});`);
  }
  for (const [name, value] of Object.entries(tokens.rounded ?? {})) {
    const v = resolveAlias(tokens, `rounded.${name}`, String(value));
    root.push(`  ${themeVar("radius", name)}: ${v};`);
    theme.push(`  ${themeVar("radius", name)}: ${v};`);
  }
  for (const [name, value] of Object.entries(tokens.spacing ?? {})) {
    const resolved = resolveAlias(tokens, `spacing.${name}`, String(value));
    const v = typeof value === "number" ? `${value}px` : resolved;
    root.push(`  ${themeVar("spacing", name)}: ${v};`);
    theme.push(`  ${themeVar("spacing", name)}: ${v};`);
  }
  for (const [name, token] of Object.entries(tokens.typography ?? {})) {
    if (token.fontSize) {
      const v = resolveAlias(tokens, `typography.${name}.fontSize`, String(token.fontSize));
      root.push(`  ${themeVar("text", name)}: ${v};`);
      theme.push(`  ${themeVar("text", name)}: ${v};`);
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
      /**
       * F001.12 — NAME THE TOKEN, never let culori's TypeError out.
       *
       * Measured on 0.4.0, and I had it BACKWARDS before I measured: I assumed
       * an unreadable colour would return [] — a silent pass, because that is
       * this week's pattern — and it does not. It CRASHES, from inside a
       * dependency:
       *
       *   TypeError: undefined is not an object (evaluating 'c.r')
       *     at luminance (culori/src/wcag.js:12)
       *
       * Wrong in the other direction, and still wrong: a consumer got a
       * third-party stack trace instead of being told which of THEIR tokens is
       * unreadable, and the WCAG checker is precisely the tool whose failure
       * must be legible.
       */
      const resolved: Record<string, string> = {};
      for (const [role, value] of [[fg, colors[fg]], [bg, colors[bg]]] as const) {
        // BOTH checks, and the order matters. assertColour deliberately skips an
        // alias (resolvability is the other check's job) — so wiring only that
        // one in left `{colors.missing}` leaking culori's TypeError anyway. My
        // own fix had the same shape as the defect: split in two, one half
        // wired. Caught only because the AC demanded both cases be asserted.
        // F001.14 — RESOLVE, then validate, then measure. Passing the raw value
        // meant a VALID alias reached culori as the string "{colors.ink}" and
        // threw its TypeError — the very crash the comment above says was fixed,
        // still reachable through the one input a real DESIGN.md contains.
        resolved[role] = resolveAlias(tokens, `colors.${role}`, String(value));
        assertColour(`colors.${role}`, resolved[role]!);
      }
      const ratio = wcagContrast(resolved[fg]!, resolved[bg]!);
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

/* ────────────────────────────────────────────────────────────────────────────
 * F001.13 — THE OTHER DIRECTION: an existing stylesheet → DESIGN.md tokens.
 *
 * Requested by cardmem (intercom #23847) and lifted from the pure function they
 * wrote for it (broberg-ai/cardmem a624ca06). They needed it to seed a DESIGN.md
 * into ~30 repos that already have a look, and their argument is the right one:
 * an empty skeleton is a file nobody fills in, while a generated seed is true on
 * day one and the repo's job shrinks to CORRECTING it.
 *
 * ─── The one constraint that shapes everything here ──────────────────────────
 *
 * The forward direction is DETERMINISTIC: a DESIGN.md fully decides the CSS.
 * This direction cannot be. A real stylesheet holds hundreds of declarations and
 * WHICH of them are tokens is a judgement, so every honest implementation here
 * is a heuristic.
 *
 * That is why it returns `{ tokens, skipped }` and never a bare token object.
 * Without the second half the misses are invisible and expensive: a repo opens
 * its seed, sees no shadow tokens, and concludes it HAS none — when the truth
 * was that we could not read them. The file looks complete. Nobody flags the
 * hole. Same family as F001.12, closed hours before this was written.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A declaration this extractor did not turn into a token, and why.
 *
 * Deliberately the same THREE-FIELD SHAPE as {@link SkippedNamespace} — what,
 * how many, why — rather than that exact type: the forward direction skips whole
 * NAMESPACES and this one skips individual DECLARATIONS, so reusing the field
 * name `namespace` for a list of property names would have been a label that
 * lies. Same channel, correct unit.
 */
export interface SkippedDeclaration {
  /** Up to four example property names, comma-joined, then `+N more`. */
  property: string;
  count: number;
  reason: string;
}

/**
 * A token that WAS extracted, but whose custom-property name would change if the
 * seed were regenerated into CSS.
 *
 * A THIRD FACT, not a skip: the token is in `tokens`. What is being reported is
 * that `var(--rounded-sm)` at an existing call-site would resolve to nothing
 * after regeneration, because this generator emits the `radius` namespace.
 *
 * Found by the round-trip invariant, not by reading the code — `--rounded-*` is
 * a name RADIUS_NAME deliberately accepts, so the token is real and the rename
 * is silent. Anything under `--radius`/`--radius-*` round-trips unchanged and is
 * not listed here.
 */
export interface RenamedToken {
  from: string;
  to: string;
}

export interface ExtractedTokens {
  /**
   * The same {@link DesignTokens} shape `parseDesignMd` produces, so the result
   * feeds straight back into {@link generateTailwindV4} without a translation
   * step — which is also what makes the round-trip testable.
   */
  tokens: DesignTokens;
  skipped: SkippedDeclaration[];
  /** Extracted, but the property name would change on regeneration. */
  renamed: RenamedToken[];
}

/** `@theme { … }` and `:root { … }` — where Tailwind v4 and plain CSS
 *  respectively keep custom properties. Both, because the fleet has both.
 *
 *  The closing brace is matched WITHOUT requiring a preceding newline (cardmem's
 *  note, and it is a good one): the first version required one, so it read every
 *  real stylesheet correctly and silently found nothing in a single-line block —
 *  exactly the shape a test fixture takes. Green guard, untested subject. */
const CSS_BLOCK = /(?:@theme|:root)[^{]*\{([\s\S]*?)\}/g;

/** A theme VARIANT block. Deliberately not read — see the skip reason. */
const VARIANT_BLOCK = /\[data-theme[^\]]*\][^{]*\{/g;

const COLOUR_VALUE = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))$/;
const LENGTH_VALUE = /^\d+(\.\d+)?(px|rem|em)$/;
/** Names that mean "radius" across the conventions the fleet actually uses. */
const RADIUS_NAME = /(^--radius|-radius$|^--rounded)/;
const VAR_ALIAS = /^var\(\s*(--[\w-]+)\s*\)$/;

/**
 * Read an existing stylesheet and report which of its custom properties are
 * design tokens — and, just as importantly, which ones are not and why.
 *
 * CLASSIFICATION IS BY VALUE FIRST, NAME SECOND (cardmem's decision, kept). A
 * repo that calls its accent `--brand-2` still has a colour; a repo with
 * `--color-transition: 200ms` does not. Trusting the name would drop a duration
 * into the palette of any repo whose conventions differ from ours, and the whole
 * point of a generated seed is that it is true for THAT repo.
 *
 * Named for its OUTPUT. cardmem's working name was `cssFromTheme`, which reads
 * as the direction we already ship — CSS *from* a theme is
 * {@link designMdToTailwindV4} — and in a shared package a name that lies about
 * the direction is worse than a clumsy one.
 */
export function designTokensFromCss(css: string): ExtractedTokens {
  const colors: Record<string, string> = {};
  const rounded: Record<string, string> = {};
  const renamed: RenamedToken[] = [];
  const skips = new Map<string, { count: number; sample: string[] }>();
  const skip = (property: string, reason: string): void => {
    const e = skips.get(reason) ?? { count: 0, sample: [] };
    e.count++;
    if (e.sample.length < 4) e.sample.push(property);
    skips.set(reason, e);
  };

  // PASS 1 — collect every declaration before classifying any of it, so a value
  // can be checked against the OTHER names in the file. Needed for the bridge
  // case below, which a single pass gets wrong in the direction that matters.
  const declared = new Map<string, string>();
  let blocks = 0;
  for (const block of css.matchAll(CSS_BLOCK)) {
    blocks++;
    // Split on `;`, not on the line start: a declaration is terminated by a
    // semicolon and both layouts occur in the wild.
    for (const raw of block[1]!.split(";")) {
      const d = /(--[\w-]+)\s*:\s*([^;]+)$/.exec(raw.replace(/\/\*[\s\S]*?\*\//g, "").trim());
      // First declaration of a name wins — later blocks are overrides, and the
      // seed describes the base theme.
      if (d && !declared.has(d[1]!)) declared.set(d[1]!, d[2]!.trim());
    }
  }

  // AC#5 — "nothing here" and "we could not find anywhere to look" are different
  // answers, and a caller must be able to tell them apart WITHOUT reading our
  // source. An empty-and-happy result is the failure shape this repo has now
  // named six times in a week.
  if (blocks === 0) {
    skip(
      "(none)",
      "no :root or @theme block was found in this stylesheet — nothing was read, which is not the same as finding no tokens",
    );
    return { tokens: {}, skipped: [...skips.entries()].map(toSkipped), renamed: [] };
  }

  const variants = [...css.matchAll(VARIANT_BLOCK)].length;
  if (variants) {
    skip(
      "(theme variants)",
      `${variants} [data-theme] block(s) were NOT read — a variant re-declares the same names with different values, and merging them would silently overwrite the base palette with whichever block came last`,
    );
  }

  for (const [name, value] of declared) {
    // THE @theme BRIDGE IS NOT A MISS. Found by running this against our own
    // css/neutral-preset.css before trusting it: the preset declares --background
    // in :root and --color-background: var(--background) in @theme. The second is
    // not a colour, so the naive pass reported ~16 of our own tokens as
    // unreadable — a seed that says "we could not read 16 of your colours" when
    // it read all of them is worse than one that says nothing.
    const alias = VAR_ALIAS.exec(value);
    if (alias && declared.has(alias[1]!)) {
      skip(name, "a var() alias of a custom property declared in the same file — the @theme bridge, not a missed token");
      continue;
    }
    const short = name.replace(/^--(color-)?/, "");
    if (COLOUR_VALUE.test(value)) {
      // First name wins, so the raw :root name beats its --color- bridge twin.
      if (!(short in colors)) colors[short] = value;
    } else if (LENGTH_VALUE.test(value) && RADIUS_NAME.test(name)) {
      // BOTH prefixes are stripped, not just `radius`. RADIUS_NAME accepts
      // `--rounded-*`, and stripping only `radius` left `rounded-sm` as the token
      // name — which regenerates as `--radius-rounded-sm`, so every
      // `var(--rounded-sm)` in that repo would resolve to nothing. Found by the
      // round-trip invariant, not by reading.
      const key = short.replace(/^(radius|rounded)-?/, "") || "DEFAULT";
      if (!(key in rounded)) {
        rounded[key] = value;
        // What this generator would emit for that key. Reported when it differs
        // from the name the stylesheet actually declares — see RenamedToken.
        const emitted = themeVar("radius", key);
        if (emitted !== name) renamed.push({ from: name, to: emitted });
      }
    } else if (/shadow/.test(name)) skip(name, "shadow — DESIGN.md has no shadow namespace yet");
    else if (/font|family/.test(name)) skip(name, "font family — DESIGN.md has no fontFamily namespace yet");
    else if (/duration|dur|ease|transition/.test(name)) skip(name, "motion — DESIGN.md has no motion namespace yet");
    else if (LENGTH_VALUE.test(value)) skip(name, "a length that is not a radius — spacing and sizing are not extracted");
    else skip(name, "value is neither a colour nor a length this extractor can express");
  }

  const tokens: DesignTokens = {};
  if (Object.keys(colors).length) tokens.colors = colors;
  if (Object.keys(rounded).length) tokens.rounded = rounded;
  return { tokens, skipped: [...skips.entries()].map(toSkipped), renamed };
}

function toSkipped([reason, e]: [string, { count: number; sample: string[] }]): SkippedDeclaration {
  return {
    property: e.sample.join(", ") + (e.count > e.sample.length ? `, +${e.count - e.sample.length} more` : ""),
    count: e.count,
    reason,
  };
}

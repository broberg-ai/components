// F001.13 — the other direction: an existing stylesheet → DESIGN.md tokens.
//
// Requested by cardmem to seed a DESIGN.md into ~30 repos that already have a
// look, and lifted from the pure function they wrote for it. The behaviour is
// theirs; the shape is this package's acceptance criteria, and where the two
// disagreed the criteria won.
//
// THE FIXTURE WE ALREADY OWN: css/neutral-preset.css and DESIGN.md are the same
// design expressed twice, in this repo, maintained together. It fails honestly
// the day they drift.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { designTokensFromCss, generateTailwindV4 } from "../src/design-md.js";

const here = dirname(fileURLToPath(import.meta.url));
const PRESET = readFileSync(join(here, "..", "css", "neutral-preset.css"), "utf8");

/** Every custom property a stylesheet DECLARES, read independently of the
 *  extractor so the round-trip cannot pass by agreeing with itself. */
function declaredProperties(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)) {
    if (!out.has(m[1]!)) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

describe("designTokensFromCss — reads our own preset", () => {
  const { tokens, skipped, renamed } = designTokensFromCss(PRESET);

  it("extracts the palette", () => {
    expect(Object.keys(tokens.colors ?? {}).length).toBeGreaterThan(10);
    expect(tokens.colors?.background).toMatch(/^oklch\(/);
    expect(tokens.colors?.foreground).toMatch(/^oklch\(/);
  });

  it("does NOT report our own @theme bridge as unreadable", () => {
    // The preset declares --background in :root AND --color-background:
    // var(--background) in @theme. A naive pass calls the second one an
    // unreadable value and reports ~16 of our own colours as missed — a seed
    // saying "could not read 16 of your colours" when it read all of them is
    // worse than one that says nothing.
    const bridge = skipped.find((s) => s.reason.includes("@theme bridge"));
    expect(bridge).toBeDefined();
    expect(bridge!.count).toBeGreaterThan(10);
    // And they are NOT absent from the palette — they were read, once.
    expect(tokens.colors?.background).toBeDefined();
  });

  it("says out loud that it did not read the theme variants", () => {
    const variants = skipped.find((s) => s.reason.includes("[data-theme]"));
    expect(variants).toBeDefined();
    expect(variants!.count).toBeGreaterThan(0);
  });

  it("renames nothing in a stylesheet that uses our own radius convention", () => {
    expect(renamed).toEqual([]);
  });
});

describe("the SUBSET round-trip — no call-site breaks", () => {
  // NOT a whole-file round-trip. That is not a property this function can have,
  // and a test claiming it would go red on every legitimate improvement to
  // either half. The invariant asserted here is the one a consumer depends on:
  // every property name the SOURCE declared for an extracted token still
  // resolves, to the same value, in the regenerated output.
  it("every extracted token still resolves under its source name", () => {
    const { tokens, renamed } = designTokensFromCss(PRESET);
    const design = `---\n${JSON.stringify(tokens)}\n---\n`;
    const { css } = generateTailwindV4(design, { tailwindImport: false });
    const regenerated = declaredProperties(css);
    const source = declaredProperties(PRESET);
    const renamedFrom = new Set(renamed.map((r) => r.from));

    const broken: string[] = [];
    for (const [name, value] of Object.entries(tokens.colors ?? {})) {
      for (const candidate of [`--${name}`, `--color-${name}`]) {
        if (!source.has(candidate)) continue;
        // Strict equality on the value, both strings printed on failure.
        const got = regenerated.get(candidate);
        const want = candidate.startsWith("--color-") ? `var(--${name})` : value;
        if (got !== want) broken.push(`${candidate}: regenerated ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
      }
    }
    for (const [name, value] of Object.entries(tokens.rounded ?? {})) {
      const emitted = name === "DEFAULT" ? "--radius" : `--radius-${name}`;
      if (renamedFrom.has(emitted)) continue;
      const got = regenerated.get(emitted);
      if (got !== value) broken.push(`${emitted}: regenerated ${JSON.stringify(got)}, expected ${JSON.stringify(value)}`);
    }
    expect(broken).toEqual([]);
  });

  // SPLIT IN TWO ON PURPOSE. Both claims lived in one test and the mutation pass
  // caught it: "the token name is wrong" and "the rename is unreported" produced
  // an IDENTICAL red set, so the suite could not tell the two defects apart. A
  // mutation harness that cannot discriminate is only proving the tests run.
  it("strips BOTH radius prefixes, so the token is named the way we emit it", () => {
    const { tokens } = designTokensFromCss(":root{--rounded-sm:4px;--card-radius:6px;--radius-lg:12px;--radius:8px}");
    expect(tokens.rounded).toEqual({ sm: "4px", "card-radius": "6px", lg: "12px", DEFAULT: "8px" });
  });

  it("REPORTS the rename when the source uses a radius name we do not emit", () => {
    // --rounded-sm is a name RADIUS_NAME deliberately accepts, so the token is
    // real — and the generator emits --radius-sm, so `var(--rounded-sm)` at an
    // existing call-site would resolve to NOTHING. Extracted AND reported: the
    // third fact, neither a token silently renamed nor a skip.
    const { renamed } = designTokensFromCss(":root{--rounded-sm:4px;--card-radius:6px;--radius-lg:12px;--radius:8px}");
    expect(renamed).toEqual([
      { from: "--rounded-sm", to: "--radius-sm" },
      { from: "--card-radius", to: "--radius-card-radius" },
    ]);
  });

  it("a name we DO emit is not reported as renamed", () => {
    // The negative control. Without it the test above passes on an
    // implementation that reports every radius token as renamed.
    expect(designTokensFromCss(":root{--radius:8px;--radius-lg:12px}").renamed).toEqual([]);
  });
});

describe("what it could not read is never silence", () => {
  it("a stylesheet with NO :root or @theme block says so — it does not return empty and happy", () => {
    // AC#5. "Nothing here" and "there was nowhere to look" are different
    // answers, and a caller must tell them apart without reading our source.
    const r = designTokensFromCss("body { color: red; }\n.x { --not-in-a-block: #fff; }");
    expect(r.tokens).toEqual({});
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.reason).toContain("no :root or @theme block");
    expect(r.skipped[0]!.reason).toContain("not the same as finding no tokens");
  });

  it("a block that yielded nothing is DISTINCT from no block at all", () => {
    // The negative control for the test above. Without it, that one passes on an
    // implementation that reports "no block" whenever it finds no tokens.
    const r = designTokensFromCss(":root { --z-modal: 50; }");
    expect(r.tokens).toEqual({});
    expect(r.skipped.some((s) => s.reason.includes("no :root or @theme block"))).toBe(false);
    expect(r.skipped[0]!.property).toBe("--z-modal");
  });

  it("names each miss with a reason and caps the examples", () => {
    const css = ":root{" + Array.from({ length: 7 }, (_, i) => `--shadow-${i}: 0 1px ${i}px #000`).join(";") + "}";
    const r = designTokensFromCss(css);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.count).toBe(7);
    expect(r.skipped[0]!.property).toBe("--shadow-0, --shadow-1, --shadow-2, --shadow-3, +3 more");
  });

  it("classifies by VALUE first and name second", () => {
    // A repo calling its accent --brand-2 still has a colour; a repo with
    // --color-transition: 200ms does not. Trusting the name would drop a
    // duration into the palette of any repo whose conventions differ from ours.
    const r = designTokensFromCss(":root{--brand-2:#123456;--color-transition:200ms}");
    expect(r.tokens.colors).toEqual({ "brand-2": "#123456" });
    expect(r.skipped.some((s) => s.property.includes("--color-transition"))).toBe(true);
  });

  it("reads a single-line block", () => {
    // cardmem's note: the first version required a newline before the closing
    // brace, so it read every real stylesheet and silently found nothing in the
    // one shape a test fixture takes — green guard, untested subject.
    expect(designTokensFromCss(":root { --a: #fff; }").tokens.colors).toEqual({ a: "#fff" });
  });

  it("a theme VARIANT never contributes a token to the base palette", () => {
    // UNCAUGHT by the first version of the mutation pass, which is the finding:
    // nothing tested this at all. Reading [data-theme] blocks would merge a
    // variant's palette into the base — and a variant that declares a token the
    // base does not (or comes first in the file) would then decide the seed.
    // Our own preset hides this, because :root is declared first and the
    // variants re-declare the same names, so a merge changes nothing there.
    const css = ":root{--background:#111}[data-theme=light]{--background:#fff;--only-in-light:#f00}";
    const r = designTokensFromCss(css);
    expect(r.tokens.colors).toEqual({ background: "#111" });
    expect(r.tokens.colors).not.toHaveProperty("only-in-light");
    expect(r.skipped.some((s) => s.reason.includes("[data-theme]"))).toBe(true);
  });

  it("a length that is not a radius is skipped for THAT reason, not a generic one", () => {
    const r = designTokensFromCss(":root{--mobile-nav-h:44px}");
    expect(r.tokens).toEqual({});
    expect(r.skipped[0]!.reason).toContain("not a radius");
  });
});

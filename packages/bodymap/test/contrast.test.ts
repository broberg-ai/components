import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultUi, uiColors, STAGE_BG, type BodymapPalette } from "../src/index.js";

/**
 * F052.19 — the anti-drift seal.
 *
 * fd-sundhed's Lens DOM critic caught `bodymap3d-empty` at 2.56:1 in production
 * (WCAG AA needs 4.5:1) on a surface bound for Aalborg Kommune, where AA is a
 * legal requirement. Re-measuring found four more failures in the same two
 * files. This test fails the build if any shipped default regresses.
 *
 * Normal-text AA is used throughout: none of the affected text qualifies for
 * the large-text exception (the hint is 13.5px; the section labels are 11px
 * bold, well under the 18.66px-bold threshold).
 */
const AA_NORMAL = 4.5;

function relativeLuminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast helper", () => {
  it("reproduces the ratio fd-sundhed measured in production", () => {
    // The exact pair that was flagged: the old muted colour on the panel.
    expect(contrast("#94a3b8", "#fff")).toBeCloseTo(2.56, 2);
  });

  it("agrees with known WCAG reference values", () => {
    expect(contrast("#000", "#fff")).toBeCloseTo(21, 1);
    expect(contrast("#fff", "#fff")).toBeCloseTo(1, 5);
  });
});

describe("shipped default chrome meets WCAG AA", () => {
  const pairs: Array<[name: string, fg: string, bg: string]> = [
    ["primary text on panel", defaultUi.text, defaultUi.panelBg],
    ["muted text on panel (hint + section labels)", defaultUi.mutedText, defaultUi.panelBg],
    ["muted text on badge background (region code)", defaultUi.mutedText, defaultUi.badgeBg],
    ["destructive action on panel (remove)", defaultUi.danger, defaultUi.panelBg],
  ];

  for (const [name, fg, bg] of pairs) {
    it(`${name} is at least ${AA_NORMAL}:1`, () => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }

  it("rejects the specific colours that failed in production", () => {
    // Guards against a well-meaning "restore the lighter grey" revert.
    expect(defaultUi.mutedText).not.toBe("#94a3b8");
    expect(defaultUi.danger).not.toBe("#ef4444");
  });
});

describe("renderer sources carry no sub-AA hardcoded text colour", () => {
  const src = (f: string) =>
    readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), "utf8");

  // The two colours that failed AA. They must not reappear as a literal in a
  // renderer — they belong to the palette/defaults now, not to inline styles.
  for (const file of ["three.tsx", "react.tsx"]) {
    it(`${file} does not hardcode #94a3b8`, () => {
      expect(src(file)).not.toContain("#94a3b8");
    });
  }

  it("react.tsx does not hardcode #ef4444 as a text colour", () => {
    // #ef4444 remains legitimate as a HEAT fill (body colour, not text).
    expect(src("react.tsx")).not.toContain("color:#ef4444");
  });

  /**
   * F052.29 — the stage colour lives in exactly ONE place.
   *
   * It used to be a literal three times in three.tsx: the three.js scene, the
   * canvas frame, and the unsupported placeholder. A `stageBg` prop that only
   * repainted the backdrop would have left the SCENE hard-coded, so a consumer
   * choosing another colour would get their backdrop around our navy — a seam
   * invisible on a desktop and obvious on a phone. That is the exact trap
   * fd-sundhed said they were avoiding by reading our number out of dist rather
   * than picking their own near-identical navy.
   */
  it("the stage colour appears as a literal in exactly one place in src", () => {
    const files = ["index.ts", "three.tsx", "react.tsx"];
    const hits = files.flatMap((f) =>
      [...src(f).matchAll(/#0e1424/gi)].map(() => f),
    );
    // The one permitted occurrence is the STAGE_BG constant itself.
    expect(hits).toEqual(["index.ts"]);
  });

  it("the stage constant is what the default palette actually ships", () => {
    // Guards the other half: a constant nobody uses is not a single source.
    expect(defaultUi.stageBg).toBe(STAGE_BG);
  });
});

describe("palette.ui themes the chrome", () => {
  it("a consumer palette overrides the defaults", () => {
    const palette = {
      body: "#ccc",
      hover: "#aaa",
      selected: "#000",
      heat: { low: "#fcd34d", mid: "#fb923c", high: "#ef4444" },
      ui: { mutedText: "#334155", danger: "#b91c1c" },
    } satisfies BodymapPalette;

    const resolved = uiColors(palette);
    expect(resolved.mutedText).toBe("#334155");
    expect(resolved.danger).toBe("#b91c1c");
    // untouched keys still come from the AA-safe defaults
    expect(resolved.panelBg).toBe(defaultUi.panelBg);
    expect(resolved.text).toBe(defaultUi.text);
  });

  it("omitting ui reproduces the defaults exactly", () => {
    expect(uiColors({ body: "#ccc", hover: "#aaa", selected: "#000", heat: defaultHeat })).toEqual(
      defaultUi,
    );
  });

  it("omitting the palette entirely still yields the defaults", () => {
    expect(uiColors()).toEqual(defaultUi);
  });
});

const defaultHeat = { low: "#fcd34d", mid: "#fb923c", high: "#ef4444" };

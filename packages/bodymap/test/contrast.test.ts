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

/**
 * F052.30 — the 3D controls must carry NO colour of their own.
 *
 * Three of these colours already existed in `chrome` and were simply not read,
 * so setting `ui.border` themed the card and not the buttons inside it. This
 * scan is what stops one creeping back as an inline style.
 */
describe("the 3D renderer's controls carry no colour of their own", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/three.tsx", import.meta.url)), "utf8");

  // COMMENTS ARE STRIPPED FIRST. Without this the file that DOCUMENTS the fix —
  // naming the three literals it removed — is the file that fails the check,
  // and the obvious "fix" is to delete the explanation.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

  it("has zero hex colour literals outside comments", () => {
    const found = [...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(found).toEqual([]);
  });

  it("the scan can actually SEE a literal — negative control", () => {
    // A regex that matched nothing would pass the test above forever. This
    // proves the instrument works before the result is believed.
    const planted = code + '\n  const x = { color: "#abcdef" };';
    expect([...planted.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])).toEqual(["#abcdef"]);
  });

  it("#64748b is gone — F052.19 replaced it for failing AA and it survived inline", () => {
    // It measured 4.34:1 on the badge background. That sweep read the defaults
    // object and never looked at the inline styles, so the claim was narrower
    // than it appeared and this colour outlived its own fix by ten weeks.
    expect(code).not.toContain("#64748b");
  });
});

describe("accent is a control colour, not a mark colour", () => {
  it("defaults to the shipped teal with white on it", () => {
    expect(defaultUi.accent).toBe("#0c7d77");
    expect(defaultUi.accentText).toBe("#fff");
  });

  it("is NOT the same field as palette.selected", () => {
    // selected is a colour ON SKIN; accent is a colour on a button. Collapsing
    // them would stop a consumer having a teal mark and a navy button.
    const p = {
      body: "#ccc", hover: "#aaa", selected: "#141969",
      heat: { low: "#fcd34d", mid: "#fb923c", high: "#ef4444" },
      ui: { accent: "#0e1424" },
    } satisfies BodymapPalette;
    expect(uiColors(p).accent).toBe("#0e1424");
    expect(uiColors(p).accent).not.toBe(p.selected);
  });

  it("the shipped accent pair passes AA", () => {
    expect(contrast(defaultUi.accentText, defaultUi.accent)).toBeGreaterThanOrEqual(AA_NORMAL);
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

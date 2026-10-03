// F001.18 — css/palettes.css: every palette × scheme is READABLE, measured from
// the package's own file, and every value is the one cardmem shipped.
//
// The contrast tests are ported from cardmem's apps/web/src/palettes.test.ts
// (their list, #1576), now reading OUR file. A palette inherits every token it
// does not override, so each block is resolved on top of its base (light or
// dark) exactly as the browser does.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = (f: string) => readFileSync(join(__dirname, f), "utf8");
const css = here("../css/palettes.css");
const vars = (s: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of s.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
};
const blockOf = (src: string, selector: RegExp): Record<string, string> => {
  const m = src.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, selector.flags));
  if (!m) throw new Error(`no block ${selector.source}`);
  return vars(m[1]!);
};

// The classic base is the FIRST :root block and the :root[data-theme='dark'] block.
const lightBase = blockOf(css, /^:root/m);
const darkBase = { ...lightBase, ...blockOf(css, /:root\[data-theme='dark'\]/) };
const block = (pal: string, theme: string) => blockOf(css, new RegExp(`:root\\[data-palette='${pal}'\\]\\[data-theme='${theme}'\\]`));

function resolve(value: string, pal: Record<string, string>, depth = 0): string {
  if (depth > 20) throw new Error(`token loop at ${value}`);
  const m = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!m) return value.trim();
  const raw = pal[m[1]!] ?? m[2];
  if (raw === undefined) throw new Error(`undefined token ${m[1]}`);
  return resolve(raw, pal, depth + 1);
}
const hex = (v: string) => {
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`not a solid hex: ${v}`);
  return v;
};
function lum(h: string): number {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const CASES = [
  ["cool", "light"], ["cool", "dark"],
  ["warm", "light"], ["warm", "dark"],
  ["broberg", "light"], ["broberg", "dark"],
] as const;

describe("every palette is readable, in both schemes (ported from cardmem F313.9)", () => {
  for (const [pal, theme] of CASES) {
    const own = block(pal, theme);
    const p = { ...(theme === "dark" ? darkBase : lightBase), ...own };
    const t = (k: string) => resolve(`var(--${k})`, p);

    test(`${pal}/${theme}: body text ≥ 4.5:1 on page, card and sunk`, () => {
      for (const s of ["bg", "bg-card", "bg-sunk"]) {
        const r = ratio(t("fg"), t(s));
        expect(r, `fg ${t("fg")} on ${s} ${t(s)} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    test(`${pal}/${theme}: muted text (gray-500) ≥ 4.5:1 on every surface it sits on`, () => {
      for (const s of ["bg", "bg-card", "bg-sunk", "gray-50", "gray-100"]) {
        const r = ratio(t("gray-500"), t(s));
        expect(r, `gray-500 ${t("gray-500")} on ${s} ${t(s)} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    test(`${pal}/${theme}: white on the button surfaces ≥ 4.5:1`, () => {
      for (const s of ["clay-btn", "olive-btn"]) {
        const r = ratio("#FFFFFF", t(s));
        expect(r, `white on ${s} ${t(s)} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    test(`${pal}/${theme}: clay-d (orange as TEXT) ≥ 4.5:1 on page, card and its own pill (clay-bg)`, () => {
      for (const s of ["bg", "bg-card", "clay-bg"]) {
        const r = ratio(t("clay-d"), t(s));
        expect(r, `clay-d ${t("clay-d")} on ${s} ${t(s)} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    test(`${pal}/${theme}: every overridden token exists in the base (a typo is not silently ignored)`, () => {
      const base = theme === "dark" ? darkBase : lightBase;
      expect(Object.keys(own).filter((k) => !(k in base))).toEqual([]);
    });
  }

  test("CONTROL: the measurement can fail — Classic dark faint text is below the line", () => {
    expect(ratio(resolve("var(--gray-400)", darkBase), resolve("var(--bg-card)", darkBase))).toBeLessThan(4.5);
  });
});

describe("Layered surfaces — four distinct, readable steps (ported from cardmem)", () => {
  function layered(pal: string, theme: string): Record<string, string> {
    return pal === "classic"
      ? blockOf(css, new RegExp(`:root\\[data-surfaces='layered'\\]:not\\(\\[data-palette\\]\\)\\[data-theme='${theme}'\\]`))
      : blockOf(css, new RegExp(`:root\\[data-surfaces='layered'\\]\\[data-palette='${pal}'\\]\\[data-theme='${theme}'\\]`));
  }
  const flat = blockOf(css, /:root(?=\s*\{\s*--surface-header)/);
  for (const pal of ["classic", "cool", "warm", "broberg"] as const) {
    for (const theme of ["light", "dark"] as const) {
      const base = theme === "dark" ? darkBase : lightBase;
      const p = { ...base, ...flat, ...(pal === "classic" ? {} : block(pal, theme)), ...layered(pal, theme) };
      const t = (k: string) => resolve(`var(--${k})`, p);

      test(`${pal}/${theme}: header, panel and workspace are three different colours; cards differ from the workspace`, () => {
        const [h, pn, w, c] = ["surface-header", "surface-panel", "surface-work", "bg-card"].map((k) => t(k).toLowerCase());
        expect(new Set([h, pn, w]).size, `${h} ${pn} ${w}`).toBe(3);
        expect(c).not.toBe(w);
      });
      test(`${pal}/${theme}: body and muted text ≥ 4.5:1 on every layered surface`, () => {
        for (const s of ["surface-header", "surface-panel", "surface-work", "bg-card"]) {
          for (const ink of ["fg", "gray-500"]) {
            const r = ratio(t(ink), t(s));
            expect(r, `${ink} ${t(ink)} on ${s} ${t(s)} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });
    }
  }

  test("Flat (no attribute) points every surface at the token it used before", () => {
    expect(flat["--surface-header"]).toBe("var(--bg)");
    expect(flat["--surface-panel"]).toBe("var(--bg)");
    expect(flat["--surface-work"]).toBe("var(--ivory)");
  });
});

describe("the values are cardmem's, not a re-typing (fixtures: cardmem origin/main 433e7e27)", () => {
  const fx = (f: string) => here(`fixtures/cardmem-433e7e27/${f}`);
  const cmLight = { ...vars(fx("design-tokens.css").split("@theme")[0]!), ...vars(fx("styles-graph-excerpt.css")) };
  const cmDark: Record<string, string> = {};
  for (const m of fx("design-tokens-dark.css").matchAll(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/g)) Object.assign(cmDark, vars(m[1]!));

  test("every classic LIGHT value equals cardmem's base", () => {
    const diff = Object.entries(lightBase).filter(([k, v]) => cmLight[k] !== v).map(([k, v]) => `${k}: ours ${v} vs cardmem ${cmLight[k]}`);
    expect(diff).toEqual([]);
    expect(Object.keys(lightBase).length).toBe(54);
  });
  test("every classic DARK value equals cardmem's dark file", () => {
    const ours = blockOf(css, /:root\[data-theme='dark'\]/);
    const diff = Object.entries(ours).filter(([k, v]) => cmDark[k] !== v).map(([k, v]) => `${k}: ours ${v} vs cardmem ${cmDark[k]}`);
    expect(diff).toEqual([]);
  });
  test("the palette and surfaces blocks are cardmem's, character for character", () => {
    const tail = (s: string) => s.slice(s.indexOf("/* ── Cool"));
    // Our file continues with the backdrop rule (F001.19), which cardmem keeps in styles.css.
    const ours = tail(css).split("\n/* ── Backdrop")[0]!;
    expect(ours).toBe(tail(fx("design-tokens-palettes.css")));
  });
});

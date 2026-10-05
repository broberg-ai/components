// F001.20 — the brand accent: a fourth axis beside theme, palette and surfaces.
//
// A palette is a SURFACE TONE, not a brand: classic, cool and warm all share one
// --accent (cool/warm never set their own). So a customer app had no way to get
// its own button colour short of overriding --accent by hand (appkit #1669,
// measured: two fictional customers on cool and warm got identical orange).
//
// The accent is written as INLINE custom properties on <html>. Inline beats every
// palette/theme selector in palettes.css, so a palette or theme switch can never
// wipe it, and no per-palette rule is needed.
import { modeLrgb, modeRgb, parseHex, useMode, wcagContrast } from "culori/fn";
import type { Rgb } from "culori/fn";

// culori/fn is the tree-shakable entry: nothing is registered until asked.
// wcagContrast converts through linear RGB, so both modes are needed.
useMode(modeRgb);
useMode(modeLrgb);

export interface AccentTokens {
  /** --accent: the brand colour, normalised to #rrggbb. */
  accent: string;
  /** --accent-fg: text/icons ON the accent, chosen for >= 4.5:1. */
  accentFg: string;
  /** --accent-soft: the accent at low alpha, for tints and focus halos. */
  accentSoft: string;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
// The ink the broberg palette already puts on its orange, and white.
const INK = "#161B22";
const WHITE = "#FFFFFF";
// Black reaches >= 4.58:1 on any colour where white falls short, so it is the
// floor that makes the 4.5 promise unconditional; INK is preferred for tone.
const BLACK = "#000000";
const AA = 4.5;
const SOFT_ALPHA = 0.14;

/**
 * Derive the three accent tokens from one brand hex (#rgb or #rrggbb).
 * Returns null for anything that is not a hex colour — never throws.
 */
export function accentTokens(hex: string): AccentTokens | null {
  if (typeof hex !== "string" || !HEX.test(hex.trim())) return null;
  const c = parseHex(hex.trim()) as Rgb | undefined;
  if (!c) return null;
  const to255 = (v: number) => Math.round(v * 255);
  const [r, g, b] = [to255(c.r), to255(c.g), to255(c.b)];
  const accent = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  const ink = wcagContrast(c, parseHex(INK)!);
  const white = wcagContrast(c, parseHex(WHITE)!);
  let accentFg = ink >= white ? INK : WHITE;
  if (Math.max(ink, white) < AA) accentFg = BLACK;
  return { accent, accentFg, accentSoft: `rgba(${r}, ${g}, ${b}, ${SOFT_ALPHA})` };
}

const VARS = ["--accent", "--accent-fg", "--accent-soft"] as const;

/**
 * Set the app's brand accent, or `null` to return to the palette's own.
 * An invalid hex changes nothing (and returns false) rather than throwing into
 * the app. Pair with `prePaintScript({ accent })` so the first paint matches.
 */
export function setAccent(hex: string | null): boolean {
  if (typeof document === "undefined") return false;
  const style = document.documentElement.style;
  if (hex === null) {
    for (const v of VARS) style.removeProperty(v);
    return true;
  }
  const t = accentTokens(hex);
  if (!t) return false;
  style.setProperty("--accent", t.accent);
  style.setProperty("--accent-fg", t.accentFg);
  style.setProperty("--accent-soft", t.accentSoft);
  return true;
}

/** The pre-paint half: the same three writes, as a script fragment. "" if invalid. */
export function accentSnippet(hex: string | undefined): string {
  if (hex === undefined) return "";
  const t = accentTokens(hex);
  if (!t) return "";
  // Values are this module's own normalised output, JSON-encoded — no caller
  // text reaches the page verbatim.
  return (
    `try{var s=document.documentElement.style;` +
    `s.setProperty("--accent",${JSON.stringify(t.accent)});` +
    `s.setProperty("--accent-fg",${JSON.stringify(t.accentFg)});` +
    `s.setProperty("--accent-soft",${JSON.stringify(t.accentSoft)})` +
    `}catch(e){}`
  );
}

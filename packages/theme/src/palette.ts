// F001.18 — the palette and surfaces axes, beside data-theme.
//
// Lifted from cardmem's lib/theme.ts (origin/main 433e7e27) so cardmem, helpdesk
// and the trail app choose colours the same way, from one source. Pairs with
// css/palettes.css.
//
// ── IDS ARE STORED VALUES, LABELS ARE SEPARATE ──────────────────────────────
// "classic" / "cool" / "warm" / "broberg" are what is in people's localStorage
// today. The labels (Ember / Graphite / Sandstone / Fjord) can change; an id
// cannot without resetting everyone's choice.
//
// ── THE DEFAULT IS "NO ATTRIBUTE" ───────────────────────────────────────────
// classic REMOVES the attribute: the CSS treats "absent" as the default, so a
// user who never picks sees the base palette with no extra selector involved.
// Since 0.13.1 (F001.24) classic is still STORED as "classic", so a choice of
// Ember can be told from no choice at all.
//
// ── SURFACES DEFAULT TO LAYERED (F001.23) ───────────────────────────────────
// Christian 10/10: «Lag skal altid være default». So flat is now the choice
// that must be REMEMBERED: it is stored as "flat", and only a stored "flat"
// reads as flat. Before 0.13.0 flat was stored by deleting the key, so a user
// who chose flat then cannot be told from one who never chose — both get
// layered once. The attribute is unchanged: data-surfaces="layered" or absent.

export type Palette = "classic" | "cool" | "warm" | "broberg";
export const PALETTES: readonly Palette[] = ["classic", "cool", "warm", "broberg"];
/** Display names. Show these; store the ids. */
export const PALETTE_LABELS: Readonly<Record<Palette, string>> = {
  classic: "Ember",
  cool: "Graphite",
  warm: "Sandstone",
  broberg: "Fjord",
};

export type Surfaces = "flat" | "layered";
export const SURFACES: readonly Surfaces[] = ["flat", "layered"];

/** F001.19 — the backdrop behind the page. neurons = no attribute. */
export type Backdrop = "neurons" | "plain";
export const BACKDROPS: readonly Backdrop[] = ["neurons", "plain"];

export const DEFAULT_PALETTE_KEY = "broberg-palette";
export const DEFAULT_BACKDROP_KEY = "broberg-backdrop";
export const DEFAULT_SURFACES_KEY = "broberg-surfaces";

export interface InitPaletteOptions {
  /** localStorage key for the palette. Default `"broberg-palette"` (cardmem passes `"cardmem.palette"`). */
  paletteKey?: string;
  /** localStorage key for surfaces. Default `"broberg-surfaces"` (cardmem passes `"cardmem.surfaces"`). */
  surfacesKey?: string;
  /** F001.19 — localStorage key for the backdrop. Default `"broberg-backdrop"` (cardmem passes `"cardmem.backdrop"`). */
  backdropKey?: string;
}

let paletteKey = DEFAULT_PALETTE_KEY;
let surfacesKey = DEFAULT_SURFACES_KEY;
let backdropKey = DEFAULT_BACKDROP_KEY;
let backdrop: Backdrop = "neurons";
const backdropListeners = new Set<(b: Backdrop) => void>();
let palette: Palette = "classic";
let surfaces: Surfaces = "layered";
const paletteListeners = new Set<(p: Palette) => void>();
const surfacesListeners = new Set<(s: Surfaces) => void>();

export function isPalette(v: unknown): v is Palette {
  return typeof v === "string" && (PALETTES as readonly string[]).includes(v);
}

function stored(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private-mode errors */
  }
}
function attr(name: string, value: string | null): void {
  if (typeof document === "undefined") return;
  if (value === null) document.documentElement.removeAttribute(name);
  else document.documentElement.setAttribute(name, value);
}

/** Read both stored choices and put them on <html>. Pass the same keys to prePaintScript. */
export function initPalette(options: InitPaletteOptions = {}): { palette: Palette; surfaces: Surfaces; backdrop: Backdrop } {
  if (options.paletteKey) paletteKey = options.paletteKey;
  if (options.surfacesKey) surfacesKey = options.surfacesKey;
  if (options.backdropKey) backdropKey = options.backdropKey;
  backdrop = stored(backdropKey) === "plain" ? "plain" : "neurons";
  attr("data-backdrop", backdrop === "plain" ? "plain" : null);
  const p = stored(paletteKey);
  palette = isPalette(p) ? p : "classic";
  surfaces = stored(surfacesKey) === "flat" ? "flat" : "layered";
  attr("data-palette", palette === "classic" ? null : palette);
  attr("data-surfaces", surfaces === "layered" ? "layered" : null);
  return { palette, surfaces, backdrop };
}

export function getPalette(): Palette {
  return palette;
}

/** Apply, persist, notify. Unknown values are ignored. */
export function setPalette(next: Palette): void {
  if (!isPalette(next)) return;
  palette = next;
  attr("data-palette", next === "classic" ? null : next);
  // F001.24 — classic is STORED, so «chose Ember» is not «chose nothing» (an
  // app that applies its brand palette when nothing is stored kept overriding it).
  store(paletteKey, next);
  for (const l of paletteListeners) l(next);
}

export function onPaletteChange(listener: (p: Palette) => void): () => void {
  paletteListeners.add(listener);
  return () => {
    paletteListeners.delete(listener);
  };
}

export function getSurfaces(): Surfaces {
  return surfaces;
}

export function setSurfaces(next: Surfaces): void {
  if (next !== "flat" && next !== "layered") return;
  surfaces = next;
  attr("data-surfaces", next === "layered" ? "layered" : null);
  store(surfacesKey, next);
  for (const l of surfacesListeners) l(next);
}

export function onSurfacesChange(listener: (s: Surfaces) => void): () => void {
  surfacesListeners.add(listener);
  return () => {
    surfacesListeners.delete(listener);
  };
}

export function getBackdrop(): Backdrop {
  return backdrop;
}

/** neurons removes the attribute and the key; plain sets both. */
export function setBackdrop(next: Backdrop): void {
  if (next !== "neurons" && next !== "plain") return;
  backdrop = next;
  const v = next === "plain" ? "plain" : null;
  attr("data-backdrop", v);
  store(backdropKey, v);
  for (const l of backdropListeners) l(next);
}

export function onBackdropChange(listener: (b: Backdrop) => void): () => void {
  backdropListeners.add(listener);
  return () => {
    backdropListeners.delete(listener);
  };
}

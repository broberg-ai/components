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
// classic and flat REMOVE the attribute (and the stored key), exactly as
// cardmem does: the CSS treats "absent" as the default, so a user who never
// picks sees the base palette with no extra selector involved.

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
let surfaces: Surfaces = "flat";
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
  surfaces = stored(surfacesKey) === "layered" ? "layered" : "flat";
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
  const v = next === "classic" ? null : next;
  attr("data-palette", v);
  store(paletteKey, v);
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
  const v = next === "layered" ? "layered" : null;
  attr("data-surfaces", v);
  store(surfacesKey, v);
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

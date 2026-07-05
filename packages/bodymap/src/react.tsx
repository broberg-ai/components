// @broberg/bodymap/react — the 2D SVG renderer (F052.2).
//
// <BodyMap> is the shippable MVP: a genderless, colour-blocked body a patient
// clicks to mark where it hurts. Selecting a region opens a custom intensity
// (0-10) + quality control (NO native inputs) that upserts a validated
// PainReport and fires onChange. Honours the per-app RegionConfig. The 3D
// <BodyMap3D> (F052.6) will render the SAME core on the SAME onChange contract.
//
// F052.8 touch-first + F052.11 a11y: the body is PRIMARILY a mobile surface, so
// every region has a >=44px transparent hit-area, the body pinch-zooms + pans
// (with a tap-vs-drag guard so a gesture never mis-marks), controls are
// thumb-sized and the layout stacks on a narrow viewport. Everything is also
// fully keyboard-operable with live-state ARIA labels + visible focus.

import { useEffect, useRef, useState } from "react";
import {
  REGIONS,
  PAIN_TYPES,
  painPointSchema,
  resolveRegions,
  isSelectable,
  getRegion,
  heatFor,
  baseColorFor,
  type BodyRegion,
  type BodymapPalette,
  type PainReport,
  type PainType,
  type RegionConfig,
} from "./index.js";

// ---- geometry: each region → an SVG shape (a neutral colour-blockout) --------

type Shape =
  | { el: "circle"; cx: number; cy: number; r: number }
  | { el: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { el: "rect"; x: number; y: number; width: number; height: number; rx: number };

// Front-view geometry (viewBox 260×470). The 2D MVP renders the front-visible
// regions; back-only regions (thora, lumbar) + hip are driven by the 3D body /
// a later back view. "left"/"right" are placed self-view (viewer's left = key
// left) for the MVP — the facing-the-patient mirror is a later config option.
const SHAPES: Record<string, Shape> = {
  head: { el: "circle", cx: 130, cy: 40, r: 26 },
  neck: { el: "rect", x: 120, y: 62, width: 20, height: 16, rx: 6 },
  chest: { el: "rect", x: 100, y: 84, width: 60, height: 104, rx: 16 },
  groin: { el: "rect", x: 106, y: 190, width: 48, height: 30, rx: 13 },
  // left arm (viewer-left)
  shoulder_left: { el: "circle", cx: 88, cy: 98, r: 14 },
  uarm_left: { el: "rect", x: 66, y: 104, width: 18, height: 54, rx: 9 },
  elbow_left: { el: "circle", cx: 73, cy: 164, r: 10 },
  farm_left: { el: "rect", x: 62, y: 174, width: 16, height: 50, rx: 8 },
  wrist_left: { el: "circle", cx: 68, cy: 230, r: 8 },
  hand_left: { el: "ellipse", cx: 67, cy: 250, rx: 11, ry: 13 },
  // right arm (viewer-right)
  shoulder_right: { el: "circle", cx: 172, cy: 98, r: 14 },
  uarm_right: { el: "rect", x: 176, y: 104, width: 18, height: 54, rx: 9 },
  elbow_right: { el: "circle", cx: 187, cy: 164, r: 10 },
  farm_right: { el: "rect", x: 182, y: 174, width: 16, height: 50, rx: 8 },
  wrist_right: { el: "circle", cx: 192, cy: 230, r: 8 },
  hand_right: { el: "ellipse", cx: 193, cy: 250, rx: 11, ry: 13 },
  // legs
  thigh_left: { el: "rect", x: 104, y: 224, width: 22, height: 80, rx: 11 },
  thigh_right: { el: "rect", x: 134, y: 224, width: 22, height: 80, rx: 11 },
  knee_left: { el: "circle", cx: 115, cy: 312, r: 13 },
  knee_right: { el: "circle", cx: 145, cy: 312, r: 13 },
  lowleg_left: { el: "rect", x: 106, y: 322, width: 18, height: 74, rx: 9 },
  lowleg_right: { el: "rect", x: 136, y: 322, width: 18, height: 74, rx: 9 },
  ankle_left: { el: "circle", cx: 115, cy: 404, r: 9 },
  ankle_right: { el: "circle", cx: 145, cy: 404, r: 9 },
  foot_left: { el: "ellipse", cx: 115, cy: 424, rx: 14, ry: 10 },
  foot_right: { el: "ellipse", cx: 145, cy: 424, rx: 14, ry: 10 },
};

const FILL: Record<string, string> = {
  head: "#cbb7ec", neck: "#b8a3e6", chest: "#e26d6d", groin: "#e88a52",
  shoulder_left: "#f6c667", shoulder_right: "#f6c667",
  uarm_left: "#7ececb", uarm_right: "#7ececb",
  elbow_left: "#86cfcc", elbow_right: "#86cfcc",
  farm_left: "#8fd0cd", farm_right: "#8fd0cd",
  wrist_left: "#9ad6d3", wrist_right: "#9ad6d3",
  hand_left: "#a7ddda", hand_right: "#a7ddda",
  thigh_left: "#7fb2e8", thigh_right: "#7fb2e8",
  knee_left: "#c79be0", knee_right: "#c79be0",
  lowleg_left: "#e39ec6", lowleg_right: "#e39ec6",
  ankle_left: "#eeaab9", ankle_right: "#eeaab9",
  foot_left: "#f0a5a5", foot_right: "#f0a5a5",
};

// Back-view geometry (same viewBox 260×470 + same limb/head geometry as the
// front, so a marked limb sits at the same spot in both views). The torso swaps
// front regions (chest, groin) for the posterior ones — THORA (upper back),
// LUMBAR (lower back) and HIP (buttocks, paired) — the pilot's blocker regions.
// Same self-view L/R convention as the front (patient-left = viewer-left).
const SHAPES_BACK: Record<string, Shape> = {
  head: { el: "circle", cx: 130, cy: 40, r: 26 },
  neck: { el: "rect", x: 120, y: 62, width: 20, height: 16, rx: 6 },
  thora: { el: "rect", x: 100, y: 84, width: 60, height: 58, rx: 15 },
  lumbar: { el: "rect", x: 104, y: 144, width: 52, height: 44, rx: 13 },
  hip_left: { el: "rect", x: 100, y: 190, width: 27, height: 32, rx: 13 },
  hip_right: { el: "rect", x: 133, y: 190, width: 27, height: 32, rx: 13 },
  // arms — shared with the front (back of the arm sits at the same x/y)
  shoulder_left: { el: "circle", cx: 88, cy: 98, r: 14 },
  uarm_left: { el: "rect", x: 66, y: 104, width: 18, height: 54, rx: 9 },
  elbow_left: { el: "circle", cx: 73, cy: 164, r: 10 },
  farm_left: { el: "rect", x: 62, y: 174, width: 16, height: 50, rx: 8 },
  wrist_left: { el: "circle", cx: 68, cy: 230, r: 8 },
  hand_left: { el: "ellipse", cx: 67, cy: 250, rx: 11, ry: 13 },
  shoulder_right: { el: "circle", cx: 172, cy: 98, r: 14 },
  uarm_right: { el: "rect", x: 176, y: 104, width: 18, height: 54, rx: 9 },
  elbow_right: { el: "circle", cx: 187, cy: 164, r: 10 },
  farm_right: { el: "rect", x: 182, y: 174, width: 16, height: 50, rx: 8 },
  wrist_right: { el: "circle", cx: 192, cy: 230, r: 8 },
  hand_right: { el: "ellipse", cx: 193, cy: 250, rx: 11, ry: 13 },
  // legs — back (thigh→calf→heel, same x/y as the front)
  thigh_left: { el: "rect", x: 104, y: 224, width: 22, height: 80, rx: 11 },
  thigh_right: { el: "rect", x: 134, y: 224, width: 22, height: 80, rx: 11 },
  knee_left: { el: "circle", cx: 115, cy: 312, r: 13 },
  knee_right: { el: "circle", cx: 145, cy: 312, r: 13 },
  lowleg_left: { el: "rect", x: 106, y: 322, width: 18, height: 74, rx: 9 },
  lowleg_right: { el: "rect", x: 136, y: 322, width: 18, height: 74, rx: 9 },
  ankle_left: { el: "circle", cx: 115, cy: 404, r: 9 },
  ankle_right: { el: "circle", cx: 145, cy: 404, r: 9 },
  foot_left: { el: "ellipse", cx: 115, cy: 424, rx: 14, ry: 10 },
  foot_right: { el: "ellipse", cx: 145, cy: 424, rx: 14, ry: 10 },
};

const FILL_BACK: Record<string, string> = {
  ...FILL,
  thora: "#e2896d",
  lumbar: "#d97fa0",
  hip_left: "#c99bd6", hip_right: "#c99bd6",
};

export type BodyView2D = "front" | "back";

// ---- i18n (F052.12) — every UI string is overridable; da + en ship ----------
// Region CODE + keys + the bodymap/v1 wire are NEVER touched — labels are
// display-only, so a report is byte-identical in any language.

export interface BodyMapLabels {
  /** Region key → display name. */
  regions: Record<string, string>;
  /** PainType → display word (e.g. "stikkende" → "Stabbing"). */
  qualities: Record<string, string>;
  intensity: string;
  quality: string;
  remove: string;
  front: string;
  back: string;
  empty: string;
  /** Compare view (F052.13). */
  before: string;
  after: string;
  noChange: string;
  change: { new: string; resolved: string; improved: string; worse: string };
  /** Accessible name for a marked region. */
  ariaMarked: (name: string, intensity: number, quality?: string) => string;
  /** Accessible name for an unmarked, selectable region. */
  ariaUnmarked: (name: string) => string;
  svgLabel: string;
  viewLabel: string;
  zoomLabel: string;
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
}

const daRegions: Record<string, string> = Object.fromEntries(REGIONS.map((r) => [r.key, r.label]));
const EN_CODE: Record<string, string> = {
  HEAD: "Head", NECK: "Neck", CHEST: "Chest", THORA: "Upper back", LUMBAR: "Lower back", GROIN: "Groin",
  SHOULDER: "Shoulder", UARM: "Upper arm", ELBOW: "Elbow", FARM: "Forearm", WRIST: "Wrist", HAND: "Hand",
  HIP: "Hip", THIGH: "Thigh", KNEE: "Knee", LOWLEG: "Lower leg", ANKLE: "Ankle", FOOT: "Foot",
};
const enRegions: Record<string, string> = Object.fromEntries(
  REGIONS.map((r) => [r.key, EN_CODE[r.code] + (r.side ? (r.side === "left" ? ", left" : ", right") : "")]),
);

export const LABELS_DA: BodyMapLabels = {
  regions: daRegions,
  qualities: { stikkende: "stikkende", dump: "dump", konstant: "konstant", jagende: "jagende" },
  intensity: "Intensitet (0-10)",
  quality: "Kvalitet",
  remove: "Fjern punkt",
  front: "Forfra",
  back: "Bagfra",
  empty: "Vælg en kropsdel for at markere smerte.",
  before: "Før",
  after: "Efter",
  noChange: "Ingen ændring",
  change: { new: "nyt", resolved: "forsvundet", improved: "bedre", worse: "værre" },
  ariaMarked: (n, i, q) => `${n}, smerte ${i} af 10${q ? ", " + q : ""}`,
  ariaUnmarked: (n) => `${n}, ikke markeret. Aktivér for at markere smerte.`,
  svgLabel: "Kropskort — vælg hvor det gør ondt",
  viewLabel: "Visning",
  zoomLabel: "Zoom",
  zoomIn: "Zoom ind",
  zoomOut: "Zoom ud",
  zoomReset: "Nulstil zoom",
};

export const LABELS_EN: BodyMapLabels = {
  regions: enRegions,
  qualities: { stikkende: "stabbing", dump: "dull", konstant: "constant", jagende: "shooting" },
  intensity: "Intensity (0-10)",
  quality: "Quality",
  remove: "Remove point",
  front: "Front",
  back: "Back",
  empty: "Pick a body part to mark pain.",
  before: "Before",
  after: "After",
  noChange: "No change",
  change: { new: "new", resolved: "resolved", improved: "improved", worse: "worse" },
  ariaMarked: (n, i, q) => `${n}, pain ${i} of 10${q ? ", " + q : ""}`,
  ariaUnmarked: (n) => `${n}, not marked. Activate to mark pain.`,
  svgLabel: "Body map — pick where it hurts",
  viewLabel: "View",
  zoomLabel: "Zoom",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomReset: "Reset zoom",
};

export type BodyMapLocale = "da" | "en";

function resolveLabels(locale: BodyMapLocale, overrides?: Partial<BodyMapLabels>): BodyMapLabels {
  const base = locale === "en" ? LABELS_EN : LABELS_DA;
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    regions: { ...base.regions, ...overrides.regions },
    qualities: { ...base.qualities, ...overrides.qualities },
  };
}

const VBW = 260;
const VBH = 470;
// The SVG renders ~320px wide → ~1.23 px per viewBox unit. A hit-area needs
// ~36 units to clear the 44px touch minimum; small regions get an invisible
// padded hit-shape at least this big (zoom handles genuinely dense clusters).
const MIN_HIT = 18; // half-extent (radius) in viewBox units

function center(s: Shape): { x: number; y: number } {
  if (s.el === "rect") return { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  return { x: s.cx, y: s.cy };
}
// An enlarged, invisible hit target so small regions clear the 44px touch min.
function hitShape(s: Shape): Shape {
  if (s.el === "circle") return { el: "circle", cx: s.cx, cy: s.cy, r: Math.max(s.r, MIN_HIT) };
  if (s.el === "ellipse")
    return { el: "ellipse", cx: s.cx, cy: s.cy, rx: Math.max(s.rx, MIN_HIT), ry: Math.max(s.ry, MIN_HIT) };
  const c = center(s);
  const w = Math.max(s.width, MIN_HIT * 2);
  const h = Math.max(s.height, MIN_HIT * 2);
  return { el: "rect", x: c.x - w / 2, y: c.y - h / 2, width: w, height: h, rx: s.rx };
}
function heat(v: number): string {
  return v >= 7 ? "#ef4444" : v >= 4 ? "#fb923c" : "#fcd34d";
}
function heatTier(v: number): "low" | "mid" | "high" {
  return v >= 7 ? "high" : v >= 4 ? "mid" : "low";
}
// F052.10 palette: a `palette` prop wins (direct colour); with no prop, a CSS-var
// chain (--bmap-region-<key> → --bmap-body) themes with the default rainbow as
// the fallback. Marked regions likewise: palette.heat or --bmap-heat-<tier>.
function baseFill(key: string, rainbow: string, palette?: BodymapPalette): string {
  return palette ? baseColorFor(key, palette) : `var(--bmap-region-${key}, var(--bmap-body, ${rainbow}))`;
}
function markedFill(v: number, palette?: BodymapPalette): string {
  return palette ? heatFor(v, palette) : `var(--bmap-heat-${heatTier(v)}, ${heat(v)})`;
}
function shapeEl(s: Shape, props: Record<string, unknown>) {
  if (s.el === "circle") return <circle cx={s.cx} cy={s.cy} r={s.r} {...props} />;
  if (s.el === "ellipse") return <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...props} />;
  return <rect x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} {...props} />;
}

// ---- one-time style injection (no external CSS; theme via CSS variables) -----

const STYLE_ID = "broberg-bodymap-styles";
const STYLE = `
.bmap{--bmap-accent:var(--primary,#0e8f8a);--bmap-line:#e2e8f0;--bmap-panel:#fff;--bmap-ink:#1e293b;--bmap-muted:#64748b;
  display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;color:var(--bmap-ink)}
.bmap__stage{display:flex;flex-direction:column;gap:10px;flex:0 1 340px;min-width:0;max-width:360px}
.bmap__bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.bmap__viewtoggle{display:inline-flex;background:#f1f5f9;border:1px solid var(--bmap-line);border-radius:10px;padding:3px;gap:2px}
.bmap__vbtn{font:inherit;font-size:13px;font-weight:600;color:#556274;background:none;border:0;border-radius:7px;padding:8px 16px;cursor:pointer;transition:color .12s,background .12s,transform .1s}
.bmap__vbtn:hover{color:var(--bmap-ink)}
.bmap__vbtn:active{transform:scale(.97)}
.bmap__vbtn--on{background:#fff;color:var(--bmap-ink);box-shadow:0 1px 2px rgba(15,23,42,.14)}
.bmap__zoom{display:inline-flex;gap:4px;margin-left:auto}
.bmap__zoom button{font:inherit;font-weight:700;font-size:16px;line-height:1;width:36px;height:36px;border:1px solid var(--bmap-line);background:#fff;color:var(--bmap-ink);border-radius:8px;cursor:pointer;transition:border-color .12s,transform .1s;display:flex;align-items:center;justify-content:center}
.bmap__zoom button:hover{border-color:var(--bmap-accent)}
.bmap__zoom button:active{transform:scale(.9)}
.bmap__zoom button:disabled{opacity:.4;cursor:default}
.bmap__svg{width:100%;height:auto;display:block;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;background:transparent;border-radius:14px}
.bmap__vis{stroke:#fff;stroke-width:2.4;pointer-events:none;transition:filter .12s,stroke .12s,stroke-width .12s}
.bmap__vis--sel{stroke:var(--bmap-accent);stroke-width:3.6}
.bmap__hit{fill:transparent;cursor:pointer;outline:none}
.bmap__hit--locked{cursor:default}
.bmap__hit:hover + .bmap__vis{filter:brightness(1.08) saturate(1.15)}
.bmap__hit:focus-visible + .bmap__vis{stroke:var(--bmap-accent);stroke-width:4;stroke-dasharray:4 2.5}
.bmap__heatn{font:700 12px ui-sans-serif;fill:#fff;pointer-events:none}
.bmap__panel{flex:1 1 240px;min-width:220px;border:1px solid var(--bmap-line);border-radius:14px;padding:16px 18px;background:var(--bmap-panel)}
.bmap__panel--empty{color:var(--bmap-muted);font-size:13.5px}
.bmap__ph{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
.bmap__ph b{font-size:16px}
.bmap__code{font:11px ui-monospace,monospace;color:var(--bmap-muted);background:#f1f5f9;border-radius:6px;padding:2px 7px}
.bmap__lbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--bmap-muted);margin:0 0 7px}
.bmap__scale{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.bmap__i{font:inherit;font-size:14px;font-weight:600;width:38px;height:38px;border-radius:9px;border:1px solid var(--bmap-line);background:#fff;color:var(--bmap-ink);cursor:pointer;transition:border-color .1s,background .1s,transform .1s}
.bmap__i:hover{border-color:var(--bmap-accent)}
.bmap__i:active{transform:scale(.9)}
.bmap__i--on{background:var(--bmap-accent);border-color:var(--bmap-accent);color:#fff}
.bmap__chips{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px}
.bmap__chip{font:inherit;font-size:13px;border:1px solid var(--bmap-line);background:#fff;color:var(--bmap-muted);border-radius:999px;padding:9px 15px;cursor:pointer;transition:.1s}
.bmap__chip:hover{border-color:var(--bmap-accent);color:var(--bmap-accent)}
.bmap__chip:active{transform:scale(.96)}
.bmap__chip--on{background:var(--bmap-ink);border-color:var(--bmap-ink);color:#fff}
.bmap__rm{font:inherit;font-size:14px;font-weight:600;border:1px solid #f6c9c9;background:#fff;color:#ef4444;border-radius:9px;padding:10px 15px;cursor:pointer;transition:.1s}
.bmap__rm:hover{background:#fef2f2}
.bmap__rm:active{transform:scale(.97)}
.bmap__i:focus-visible,.bmap__chip:focus-visible,.bmap__vbtn:focus-visible,.bmap__rm:focus-visible,.bmap__zoom button:focus-visible{outline:2px solid var(--bmap-accent);outline-offset:2px}
.bmapc{--bmap-accent:var(--primary,#0e8f8a);--bmap-line:#e2e8f0;--bmap-ink:#1e293b;--bmap-muted:#64748b;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;color:var(--bmap-ink)}
.bmapc__bodies{display:flex;gap:14px;flex-wrap:wrap}
.bmapc__fig{flex:1 1 150px;min-width:130px;max-width:220px;margin:0;text-align:center}
.bmapc__cap{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#556274;margin-bottom:6px}
.bmapc__svg{width:100%;height:auto;display:block}
.bmapc__vis{stroke:#fff;stroke-width:2.4}
.bmapc__n{font:700 12px ui-sans-serif;fill:#fff;pointer-events:none}
.bmapc__delta{margin-top:16px;display:flex;flex-direction:column;gap:6px;max-width:460px}
.bmapc__row{display:flex;align-items:center;gap:10px;font-size:13.5px;border:1px solid var(--bmap-line);border-radius:9px;padding:7px 11px}
.bmapc__rname{font-weight:600;flex:1 1 auto}
.bmapc__rval{font:12px ui-monospace,monospace;color:#556274;white-space:nowrap}
.bmapc__badge{font-size:11px;font-weight:700;border-radius:6px;padding:2px 8px;white-space:nowrap}
.bmapc__badge--improved{background:#dcfce7;color:#166534}
.bmapc__badge--worse{background:#fee2e2;color:#991b1b}
.bmapc__badge--new{background:#fef3c7;color:#92400e}
.bmapc__badge--resolved{background:#e2e8f0;color:#475569}
.bmapc__empty{color:#556274;font-size:13.5px;margin-top:14px}
@media (max-width:560px){
  .bmap{flex-direction:column;gap:14px}
  .bmap__stage{max-width:100%;width:100%;flex-basis:auto}
  .bmap__panel{width:100%}
  .bmap__i{width:46px;height:46px;font-size:16px}
  .bmap__chip{padding:11px 17px;font-size:15px}
  .bmap__vbtn{padding:10px 18px;font-size:15px}
}
@media (prefers-reduced-motion:reduce){.bmap *{transition:none !important}}
`;

function ensureStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

// ---- component ---------------------------------------------------------------

export interface BodyMapProps {
  /** Controlled report. Omit for an uncontrolled component (use defaultValue). */
  value?: PainReport;
  /** Initial report when uncontrolled. */
  defaultValue?: PainReport;
  /** Fired with the full validated PainReport on every change. */
  onChange?: (report: PainReport) => void;
  /** Per-app region config (visible / selectable). */
  config?: RegionConfig;
  /** Initial body view (front / back). Default "front". */
  defaultView?: BodyView2D;
  /** Fired when the user toggles the front/back view — pass it to
   *  serializeReport({ view }) so the wire report carries the active view. */
  onViewChange?: (view: BodyView2D) => void;
  /** Colour theme (F052.10). Overrides the default rainbow: body/hover/selected/
   *  heat + optional per-region base colours. Without it, the rainbow is used
   *  (themeable via --bmap-body / --bmap-region-<key> / --bmap-heat-* CSS vars). */
  palette?: BodymapPalette;
  /** UI language (F052.12). "da" (default) or "en". */
  locale?: BodyMapLocale;
  /** Override individual UI strings (region names, headings, quality words, …).
   *  Merged over the locale set — region CODE + wire format are never affected. */
  labels?: Partial<BodyMapLabels>;
  /** Display-only mode (F052.9): render a saved report coloured by intensity
   *  with NO picker and no interactivity. For journals, PDFs, clinician views. */
  readOnly?: boolean;
  className?: string;
}

const ZMIN = 1;
const ZMAX = 4;
const clampPan = (p: { x: number; y: number }, z: number) => ({
  x: Math.min(0, Math.max(VBW * (1 - z), p.x)),
  y: Math.min(0, Math.max(VBH * (1 - z), p.y)),
});

/** 2D SVG body pain-map. Click/tap a region → set intensity + quality → PainReport. */
export function BodyMap({
  value, defaultValue, onChange, config = {}, defaultView = "front", onViewChange,
  palette, locale = "da", labels, readOnly = false, className,
}: BodyMapProps) {
  useEffect(ensureStyles, []);
  const [internal, setInternal] = useState<PainReport>(defaultValue ?? []);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<BodyView2D>(defaultView);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const report = value ?? internal;
  const shapes = view === "back" ? SHAPES_BACK : SHAPES;
  const fills = view === "back" ? FILL_BACK : FILL;
  const L = resolveLabels(locale, labels);
  const nameOf = (key: string) => L.regions[key] ?? getRegion(key)?.label ?? key;

  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ startDist: 0, startZoom: 1, midVB: { x: 0, y: 0 }, start: { x: 0, y: 0 }, moved: false });
  const suppressClick = useRef(false);

  const setZP = (z: number, p: { x: number; y: number }) => {
    const cz = Math.max(ZMIN, Math.min(ZMAX, z));
    const cp = clampPan(p, cz);
    zoomRef.current = cz; panRef.current = cp;
    setZoom(cz); setPan(cp);
  };
  const screenToVB = (cx: number, cy: number) => {
    const el = svgRef.current;
    if (!el) return { x: VBW / 2, y: VBH / 2 };
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { x: VBW / 2, y: VBH / 2 };
    return { x: ((cx - r.left) / r.width) * VBW, y: ((cy - r.top) / r.height) * VBH };
  };
  // Zoom keeping the given viewBox focal point under the cursor/fingers.
  const zoomTo = (nz: number, focalVB: { x: number; y: number }) => {
    const z = Math.max(ZMIN, Math.min(ZMAX, nz));
    const p = panRef.current;
    setZP(z, { x: focalVB.x - (focalVB.x - p.x) * (z / zoomRef.current), y: focalVB.y - (focalVB.y - p.y) * (z / zoomRef.current) });
  };
  const zoomBtn = (factor: number) => zoomTo(zoomRef.current * factor, { x: VBW / 2, y: VBH / 2 });
  const resetZoom = () => setZP(1, { x: 0, y: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current.startDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      gesture.current.startZoom = zoomRef.current;
      gesture.current.midVB = screenToVB((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      gesture.current.moved = true;
      suppressClick.current = true;
    } else {
      gesture.current.start = { x: e.clientX, y: e.clientY };
      gesture.current.moved = false;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (gesture.current.startDist > 0) zoomTo(gesture.current.startZoom * (dist / gesture.current.startDist), gesture.current.midVB);
      return;
    }
    const el = svgRef.current;
    const rect = el?.getBoundingClientRect();
    if (Math.hypot(e.clientX - gesture.current.start.x, e.clientY - gesture.current.start.y) > 6) {
      gesture.current.moved = true;
      suppressClick.current = true;
    }
    if (zoomRef.current > 1 && rect && rect.width) {
      const dxVB = ((e.clientX - prev.x) / rect.width) * VBW;
      const dyVB = ((e.clientY - prev.y) / rect.height) * VBH;
      setZP(zoomRef.current, { x: panRef.current.x + dxVB, y: panRef.current.y + dyVB });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) window.setTimeout(() => { suppressClick.current = false; }, 60);
  };

  const changeView = (v: BodyView2D) => {
    if (v === view) return;
    setView(v);
    const sh = v === "back" ? SHAPES_BACK : SHAPES;
    if (selected && !sh[selected]) setSelected(null); // selected region absent in the new view
    onViewChange?.(v);
  };

  const commit = (next: PainReport) => {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  };
  const pointOf = (key: string) => report.find((p) => p.region === key);
  const setPain = (key: string, intensity: number, type?: PainType) => {
    const point = painPointSchema.parse({ region: key, intensity, type, timestamp: new Date().toISOString() });
    commit([...report.filter((p) => p.region !== key), point]);
  };
  const removePain = (key: string) => {
    commit(report.filter((p) => p.region !== key));
    setSelected(null);
  };
  const pickRegion = (key: string) => {
    if (suppressClick.current) { suppressClick.current = false; return; } // a pan/pinch just ended — not a tap
    setSelected(key);
  };

  const regions = resolveRegions(config);
  const region: BodyRegion | undefined = selected ? REGIONS.find((r) => r.key === selected) : undefined;
  const current = selected ? pointOf(selected) : undefined;
  const rootCls = ["bmap", className].filter(Boolean).join(" ");
  // palette.selected drives the focus/selected stroke via --bmap-accent.
  const rootStyle = palette ? ({ "--bmap-accent": palette.selected } as React.CSSProperties) : undefined;
  const ariaFor = (r: BodyRegion, marked?: PainReport[number], interactive = true): string => {
    if (marked) return L.ariaMarked(nameOf(r.key), marked.intensity, marked.type ? L.qualities[marked.type] : undefined);
    return interactive ? L.ariaUnmarked(nameOf(r.key)) : nameOf(r.key);
  };

  return (
    <div className={rootCls} data-testid="bodymap-root" style={rootStyle}>
      <div className="bmap__stage">
        <div className="bmap__bar">
          <div className="bmap__viewtoggle" role="group" aria-label={L.viewLabel}>
            <button
              type="button"
              className={"bmap__vbtn" + (view === "front" ? " bmap__vbtn--on" : "")}
              data-testid="bodymap-view-front"
              aria-pressed={view === "front"}
              onClick={() => changeView("front")}
            >
              {L.front}
            </button>
            <button
              type="button"
              className={"bmap__vbtn" + (view === "back" ? " bmap__vbtn--on" : "")}
              data-testid="bodymap-view-back"
              aria-pressed={view === "back"}
              onClick={() => changeView("back")}
            >
              {L.back}
            </button>
          </div>
          <div className="bmap__zoom" role="group" aria-label={L.zoomLabel}>
            <button type="button" data-testid="bodymap-zoom-out" aria-label={L.zoomOut} disabled={zoom <= ZMIN} onClick={() => zoomBtn(1 / 1.4)}>−</button>
            <button type="button" data-testid="bodymap-zoom-reset" aria-label={L.zoomReset} disabled={zoom === 1 && pan.x === 0 && pan.y === 0} onClick={resetZoom}>⤢</button>
            <button type="button" data-testid="bodymap-zoom-in" aria-label={L.zoomIn} disabled={zoom >= ZMAX} onClick={() => zoomBtn(1.4)}>+</button>
          </div>
        </div>
        <svg
          ref={svgRef}
          className="bmap__svg"
          viewBox="0 0 260 470"
          role="group"
          aria-label={L.svgLabel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => zoomTo(zoomRef.current * (e.deltaY < 0 ? 1.12 : 1 / 1.12), screenToVB(e.clientX, e.clientY))}
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {regions.map((r) => {
              const s = shapes[r.key];
              if (!s) return null;
              const marked = pointOf(r.key);
              const interactive = isSelectable(r.key, config) && !readOnly;
              const visCls = ["bmap__vis", selected === r.key && "bmap__vis--sel"].filter(Boolean).join(" ");
              const fill = marked ? markedFill(marked.intensity, palette) : baseFill(r.key, fills[r.key] ?? "#cbd5e1", palette);
              const hs = hitShape(s);
              return (
                <g key={r.key}>
                  {shapeEl(hs, {
                    className: "bmap__hit" + (interactive ? "" : " bmap__hit--locked"),
                    "data-testid": `bodymap-region-${r.key}`,
                    role: interactive ? "button" : "img",
                    tabIndex: interactive ? 0 : -1,
                    "aria-label": ariaFor(r, marked, interactive),
                    "aria-pressed": interactive ? selected === r.key : undefined,
                    onClick: interactive ? () => pickRegion(r.key) : undefined,
                    onKeyDown: interactive
                      ? (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); suppressClick.current = false; setSelected(r.key); } }
                      : undefined,
                  })}
                  {shapeEl(s, { className: visCls, fill, opacity: !readOnly && !isSelectable(r.key, config) ? 0.4 : 1 })}
                </g>
              );
            })}
            {/* intensity numbers on marked regions visible in the current view */}
            {report.map((p) => {
              const s = shapes[p.region];
              if (!s || config[p.region]?.visible === false) return null;
              const c = center(s);
              return (
                <text key={p.region} x={c.x} y={c.y + 4} textAnchor="middle" className="bmap__heatn">
                  {p.intensity}
                </text>
              );
            })}
          </g>
        </svg>
      </div>

      {/* picker panel — hidden entirely in readOnly (display-only) mode */}
      {readOnly ? null : region ? (
        <div className="bmap__panel" data-testid="bodymap-panel">
          <div className="bmap__ph">
            <b>{nameOf(region.key)}</b>
            <span className="bmap__code">{region.code}</span>
          </div>
          <p className="bmap__lbl" id="bmap-intensity-lbl">{L.intensity}</p>
          <div className="bmap__scale" role="group" aria-labelledby="bmap-intensity-lbl">
            {Array.from({ length: 11 }, (_, n) => (
              <button
                key={n}
                type="button"
                className={"bmap__i" + (current?.intensity === n ? " bmap__i--on" : "")}
                data-testid={`bodymap-intensity-${n}`}
                aria-pressed={current?.intensity === n}
                onClick={() => setPain(region.key, n, current?.type)}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="bmap__lbl" id="bmap-quality-lbl">{L.quality}</p>
          <div className="bmap__chips" role="group" aria-labelledby="bmap-quality-lbl">
            {PAIN_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={"bmap__chip" + (current?.type === t ? " bmap__chip--on" : "")}
                data-testid={`bodymap-type-${t}`}
                aria-pressed={current?.type === t}
                onClick={() => setPain(region.key, current?.intensity ?? 5, t)}
              >
                {L.qualities[t]}
              </button>
            ))}
          </div>
          {current && (
            <button type="button" className="bmap__rm" data-testid="bodymap-remove" onClick={() => removePain(region.key)}>
              {L.remove}
            </button>
          )}
        </div>
      ) : (
        <div className="bmap__panel bmap__panel--empty" data-testid="bodymap-panel">
          {L.empty}
        </div>
      )}
    </div>
  );
}

// ---- <BodyMapCompare> — before/after progress (F052.13) ---------------------
// Two read-only bodies side by side + a per-region change list (improved /
// worse / new / resolved). Pure UI over two PainReports — no network. NB: the
// "nudge the user to update their report over time" is the CONSUMER app's job
// (fd-sundhed's mobile app via @broberg/webpush), NOT this component.

type RegionChange = "new" | "resolved" | "improved" | "worse" | "same";
function changeOf(b?: number, a?: number): RegionChange {
  if (b == null && a != null) return "new";
  if (b != null && a == null) return "resolved";
  if (b == null || a == null) return "same";
  return a < b ? "improved" : a > b ? "worse" : "same";
}

function CompareFigure({ report, view, palette, caption, testid }: {
  report: PainReport; view: BodyView2D; palette?: BodymapPalette; caption: string; testid: string;
}) {
  const shapes = view === "back" ? SHAPES_BACK : SHAPES;
  const fills = view === "back" ? FILL_BACK : FILL;
  return (
    <figure className="bmapc__fig" data-testid={testid}>
      <figcaption className="bmapc__cap">{caption}</figcaption>
      <svg className="bmapc__svg" viewBox="0 0 260 470" role="img" aria-label={caption}>
        {REGIONS.map((r) => {
          const s = shapes[r.key];
          if (!s) return null;
          const m = report.find((p) => p.region === r.key);
          const fill = m ? markedFill(m.intensity, palette) : baseFill(r.key, fills[r.key] ?? "#cbd5e1", palette);
          return <g key={r.key}>{shapeEl(s, { className: "bmapc__vis", fill })}</g>;
        })}
        {report.map((p) => {
          const s = shapes[p.region];
          if (!s) return null;
          const c = center(s);
          return (
            <text key={p.region} x={c.x} y={c.y + 4} textAnchor="middle" className="bmapc__n">{p.intensity}</text>
          );
        })}
      </svg>
    </figure>
  );
}

export interface BodyMapCompareProps {
  /** The earlier report. */
  before: PainReport;
  /** The later report. */
  after: PainReport;
  palette?: BodymapPalette;
  locale?: BodyMapLocale;
  labels?: Partial<BodyMapLabels>;
  defaultView?: BodyView2D;
  className?: string;
}

/** Read-only before/after view: two bodies side by side + a per-region change list. */
export function BodyMapCompare({
  before, after, palette, locale = "da", labels, defaultView = "front", className,
}: BodyMapCompareProps) {
  useEffect(ensureStyles, []);
  const [view, setView] = useState<BodyView2D>(defaultView);
  const L = resolveLabels(locale, labels);
  const nameOf = (k: string) => L.regions[k] ?? getRegion(k)?.label ?? k;
  const rootStyle = palette ? ({ "--bmap-accent": palette.selected } as React.CSSProperties) : undefined;

  const keys = Array.from(new Set([...before, ...after].map((p) => p.region)));
  const changes = keys
    .map((k) => ({
      key: k,
      b: before.find((p) => p.region === k)?.intensity,
      a: after.find((p) => p.region === k)?.intensity,
      status: changeOf(before.find((p) => p.region === k)?.intensity, after.find((p) => p.region === k)?.intensity),
    }))
    .filter((c) => c.status !== "same")
    .sort((x, y) => (x.key < y.key ? -1 : 1));

  return (
    <div className={["bmapc", className].filter(Boolean).join(" ")} data-testid="bodymap-compare" style={rootStyle}>
      <div className="bmap__viewtoggle" role="group" aria-label={L.viewLabel} style={{ marginBottom: 12 }}>
        <button type="button" className={"bmap__vbtn" + (view === "front" ? " bmap__vbtn--on" : "")} data-testid="bodymap-compare-view-front" aria-pressed={view === "front"} onClick={() => setView("front")}>{L.front}</button>
        <button type="button" className={"bmap__vbtn" + (view === "back" ? " bmap__vbtn--on" : "")} data-testid="bodymap-compare-view-back" aria-pressed={view === "back"} onClick={() => setView("back")}>{L.back}</button>
      </div>
      <div className="bmapc__bodies">
        <CompareFigure report={before} view={view} palette={palette} caption={L.before} testid="bodymap-compare-before" />
        <CompareFigure report={after} view={view} palette={palette} caption={L.after} testid="bodymap-compare-after" />
      </div>
      {changes.length ? (
        <div className="bmapc__delta" data-testid="bodymap-compare-delta">
          {changes.map((c) => (
            <div key={c.key} className="bmapc__row" data-testid={`bodymap-compare-delta-${c.key}`}>
              <span className="bmapc__rname">{nameOf(c.key)}</span>
              <span className="bmapc__rval">{c.b ?? "–"} → {c.a ?? "–"}</span>
              <span className={`bmapc__badge bmapc__badge--${c.status}`}>{L.change[c.status as Exclude<RegionChange, "same">]}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="bmapc__empty" data-testid="bodymap-compare-delta">{L.noChange}</div>
      )}
    </div>
  );
}

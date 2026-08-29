// @broberg/bodymap — headless core (F052.1).
//
// Framework-neutral: the region taxonomy + the PainReport data model (zod) + a
// selection engine + per-app region config. NO React/Preact/DOM import — the 2D
// (SVG) and 3D (Three.js) renderers, and all three FD apps, share this one
// contract. Output is a structured PainReport, never a bare image.

import { z } from "zod";

export type Side = "left" | "right";

export interface BodyRegion {
  /** Stable, unique identifier (snake_case) — the key used in a PainReport. */
  key: string;
  /** Human label (Danish). */
  label: string;
  /** Clinical short code (unique). */
  code: string;
  /** Body side, when the region is paired. */
  side?: Side;
}

/** The canonical body regions — the AUTHORITATIVE fd-sundhed clinical taxonomy
 *  (docs/BODYMAP-TAKSONOMI.md, broberg-ai/fd-sundhed @360842f): 18 SIDE-LESS
 *  clinical codes + a separate `side` field (L/R on limbs, C=center on axis
 *  regions). The `key` is a unique per-side identifier; `code` is the side-less
 *  clinical code that goes on the bodymap/v1 wire. NOT an anatomical atlas —
 *  ~30 named surface regions for a pain-map. The 2D front renderer draws the
 *  front-visible subset; the 3D body (F052.6) drives them all. */
export const REGIONS: readonly BodyRegion[] = [
  // axis / centre-line (serialised side "center")
  { key: "head", label: "Hoved", code: "HEAD" },
  { key: "neck", label: "Nakke", code: "NECK" },
  { key: "chest", label: "Bryst", code: "CHEST" },
  { key: "thora", label: "Øvre ryg (thorakal)", code: "THORA" },
  { key: "lumbar", label: "Lænd (lumbal)", code: "LUMBAR" },
  { key: "groin", label: "Lyske", code: "GROIN" },
  // paired limbs / sides (L / R)
  { key: "shoulder_left", label: "Skulder, venstre", code: "SHOULDER", side: "left" },
  { key: "shoulder_right", label: "Skulder, højre", code: "SHOULDER", side: "right" },
  { key: "uarm_left", label: "Overarm, venstre", code: "UARM", side: "left" },
  { key: "uarm_right", label: "Overarm, højre", code: "UARM", side: "right" },
  { key: "elbow_left", label: "Albue, venstre", code: "ELBOW", side: "left" },
  { key: "elbow_right", label: "Albue, højre", code: "ELBOW", side: "right" },
  { key: "farm_left", label: "Underarm, venstre", code: "FARM", side: "left" },
  { key: "farm_right", label: "Underarm, højre", code: "FARM", side: "right" },
  { key: "wrist_left", label: "Håndled, venstre", code: "WRIST", side: "left" },
  { key: "wrist_right", label: "Håndled, højre", code: "WRIST", side: "right" },
  { key: "hand_left", label: "Hånd, venstre", code: "HAND", side: "left" },
  { key: "hand_right", label: "Hånd, højre", code: "HAND", side: "right" },
  { key: "hip_left", label: "Hofte, venstre", code: "HIP", side: "left" },
  { key: "hip_right", label: "Hofte, højre", code: "HIP", side: "right" },
  { key: "thigh_left", label: "Lår, venstre", code: "THIGH", side: "left" },
  { key: "thigh_right", label: "Lår, højre", code: "THIGH", side: "right" },
  { key: "knee_left", label: "Knæ, venstre", code: "KNEE", side: "left" },
  { key: "knee_right", label: "Knæ, højre", code: "KNEE", side: "right" },
  { key: "lowleg_left", label: "Underben, venstre", code: "LOWLEG", side: "left" },
  { key: "lowleg_right", label: "Underben, højre", code: "LOWLEG", side: "right" },
  { key: "ankle_left", label: "Ankel, venstre", code: "ANKLE", side: "left" },
  { key: "ankle_right", label: "Ankel, højre", code: "ANKLE", side: "right" },
  { key: "foot_left", label: "Fod, venstre", code: "FOOT", side: "left" },
  { key: "foot_right", label: "Fod, højre", code: "FOOT", side: "right" },
];

const REGION_KEY_SET = new Set(REGIONS.map((r) => r.key));
export const REGION_KEYS: readonly string[] = REGIONS.map((r) => r.key);

/** Look up a region by its key. */
export function getRegion(key: string): BodyRegion | undefined {
  return REGIONS.find((r) => r.key === key);
}

// ---- PainReport model ---------------------------------------------------

export const PAIN_TYPES = ["stikkende", "dump", "konstant", "jagende"] as const;
export type PainType = (typeof PAIN_TYPES)[number];

/** One marked pain point. `region` MUST be a known region key; `intensity` is a
 *  0-10 integer; `type` is optional but constrained; `timestamp` is an ISO string. */
export const painPointSchema = z.object({
  region: z.string().refine((k) => REGION_KEY_SET.has(k), { message: "unknown region" }),
  intensity: z.number().int().min(0).max(10),
  type: z.enum(PAIN_TYPES).optional(),
  timestamp: z.string(),
});
export type PainPoint = z.infer<typeof painPointSchema>;

export const painReportSchema = z.array(painPointSchema);
export type PainReport = PainPoint[];

// ---- Selection engine (framework-agnostic) ------------------------------

export interface PainSelection {
  /** Mark (or update) pain on a region. One point per region — latest wins. */
  set(region: string, intensity: number, type?: PainType): PainPoint;
  remove(region: string): boolean;
  get(region: string): PainPoint | undefined;
  has(region: string): boolean;
  clear(): void;
  /** The current, validated PainReport. */
  getReport(): PainReport;
}

export interface PainSelectionOptions {
  /** Injectable clock (ISO string) — defaults to `new Date().toISOString()`. */
  now?: () => string;
}

/** Create a selection engine seeded with an optional report. Pure state — no
 *  DOM, no framework, no network. One point per region. */
export function createPainSelection(
  initial: PainReport = [],
  opts: PainSelectionOptions = {},
): PainSelection {
  const now = opts.now ?? (() => new Date().toISOString());
  const map = new Map<string, PainPoint>();
  for (const p of initial) {
    const v = painPointSchema.parse(p);
    map.set(v.region, v);
  }
  return {
    set(region, intensity, type) {
      const point = painPointSchema.parse({ region, intensity, type, timestamp: now() });
      map.set(point.region, point);
      return point;
    },
    remove: (region) => map.delete(region),
    get: (region) => map.get(region),
    has: (region) => map.has(region),
    clear: () => map.clear(),
    getReport: () => painReportSchema.parse(Array.from(map.values())),
  };
}

// ---- Per-app region config (the toggle) ---------------------------------

export interface RegionSetting {
  /** Render this region at all. Default true. */
  visible?: boolean;
  /** Allow marking pain on this region. Default true. */
  selectable?: boolean;
}

/** Per-app config keyed by region key. An absent key ⇒ visible + selectable. */
export type RegionConfig = Record<string, RegionSetting>;

/** The regions an app should render, honouring `visible` (default true). */
export function resolveRegions(config: RegionConfig = {}): BodyRegion[] {
  return REGIONS.filter((r) => config[r.key]?.visible ?? true);
}

/**
 * What a pick on a region should DO (F052.20).
 *
 * Lives in the core because the 2D and 3D renderers share no click code, and a
 * rule written twice is a rule that drifts. This repo measured the cost of that
 * twice on 2026-08-28 alone: a fix applied to one half of a pair, and a sibling
 * branch that carried the same defect with no test on it.
 *
 *   "clear"   the region is already marked → picking it again removes the mark
 *   "select"  unmarked → open it for marking
 *   "ignore"  not selectable (read-only or config) → nothing happens
 *
 * Three outcomes, not a boolean: "nothing happened because it is locked" and
 * "nothing happened because we removed the mark" must never look alike to a
 * caller.
 */
export type PickOutcome = "clear" | "select" | "ignore";

export function decidePick(
  region: string,
  report: PainReport,
  config: RegionConfig = {},
): PickOutcome {
  if (!isSelectable(region, config)) return "ignore";
  return report.some((p) => p.region === region) ? "clear" : "select";
}

/** Whether a region may be marked. A hidden region is never selectable. */
export function isSelectable(key: string, config: RegionConfig = {}): boolean {
  const s = config[key];
  if (s?.visible === false) return false;
  return s?.selectable ?? true;
}

// ---- feedback signal: sound + haptics (F052.22) -----------------------------

/**
 * What a pick did, handed to the consuming app so it can make a sound or a buzz.
 *
 * The outcome is the one `decidePick` ACTUALLY returned, never the intent to tap
 * — so a tap on a locked region can not announce itself as a removal, and a tap
 * the pan/pinch guard swallowed emits nothing at all (it never gets here).
 *
 * It deliberately reuses `PickOutcome` rather than introducing a second
 * three-word vocabulary. Two enums meaning the same thing is a drift bug waiting
 * for the first person who adds a fourth outcome to only one of them.
 */
export interface FeedbackSignal {
  outcome: PickOutcome;
  /** The region key that was picked. */
  region: string;
}

export type FeedbackFn = (signal: FeedbackSignal) => void;

/**
 * What the BROWSER did with a vibration request.
 *
 * ⚠️ `requested` does NOT mean the phone buzzed. `navigator.vibrate()` returns
 * true for a request it accepted, and all of these accept it and then produce
 * nothing: silent / do-not-disturb mode, a device with no vibration motor (most
 * laptops), a page that has not yet had a qualifying user gesture.
 *
 * Same lesson `@broberg/webpush` 0.3.1 recorded — a push that provably ARRIVED
 * on a device that never SHOWED it. "Accepted" and "happened" are two claims,
 * and only one of them is observable from here.
 */
export type VibrateOutcome = "unsupported" | "skipped" | "declined" | "requested";

/**
 * The buzz for each outcome.
 *
 * `ignore` is empty ON PURPOSE: a tap that changed nothing must not feel like it
 * changed something. That is the whole reason this is keyed by outcome and not
 * fired from the tap handler.
 */
export const VIBRATION_PATTERNS: Record<PickOutcome, readonly number[]> = {
  select: [12],
  clear: [8, 40, 8],
  ignore: [],
};

interface Vibrator {
  vibrate?: (pattern: number | number[]) => boolean;
}

/**
 * Ask the browser to vibrate. Never throws, never claims delivery.
 *
 * `nav` is injectable so a test can supply all four cases; it defaults to the
 * real `navigator` and is `unsupported` when there is not one (SSR, and every
 * browser on iPhone — WebKit has no `vibrate` at all).
 */
export function requestVibration(
  pattern: readonly number[],
  nav: Vibrator | undefined = (globalThis as { navigator?: Vibrator }).navigator,
): VibrateOutcome {
  if (pattern.length === 0) return "skipped";
  if (typeof nav?.vibrate !== "function") return "unsupported";
  try {
    return nav.vibrate([...pattern]) ? "requested" : "declined";
  } catch {
    // Embedded webviews and cross-origin iframes throw rather than return false.
    // A refused buzz must never take the pain report down with it.
    return "declined";
  }
}

export interface FeedbackOptions {
  onFeedback?: FeedbackFn;
  /** Web vibration on select/clear. Default true; inert where the API is absent. */
  haptics?: boolean;
  /** Injectable for tests. */
  nav?: unknown;
}

/**
 * Emit one pick's feedback: always the signal, optionally the buzz.
 *
 * Lives in the core because the 2D and 3D renderers share no click code, and a
 * rule written twice is a rule that drifts — the same reason `decidePick` is
 * here (F052.20).
 *
 * Sound is NOT here and never will be: `@broberg/soundkit` already exists, and
 * pulling Web Audio into a component that is often rendered read-only (a
 * journal, a PDF, a clinician view) is a cost every consumer would pay for a
 * feature most will not switch on. Wire `onFeedback` to it in four lines.
 */
export function emitFeedback(
  outcome: PickOutcome,
  region: string,
  opts: FeedbackOptions = {},
): VibrateOutcome {
  opts.onFeedback?.({ outcome, region });
  if (opts.haptics === false) return "skipped";
  // `undefined` falls through to requestVibration's own default (the real
  // navigator) — so an omitted `nav` and a passed-in one take the same path.
  return requestVibration(VIBRATION_PATTERNS[outcome], opts.nav as Vibrator | undefined);
}

// ---- palette (consumer-defined colours — shared by the 2D + 3D renderers) ---

/** Colour control for the body renderers. Consumers pass a palette to theme the
 *  body base colour, the hover + selected highlights, the pain-heat colours, and
 *  optional per-region base colours. All values are CSS/hex colour strings. */
export interface BodymapPalette {
  /** Base body colour (an unmarked region). */
  body: string;
  /** Region highlight on hover (before click). */
  hover: string;
  /** A region selected (clicked) but not yet given an intensity. */
  selected: string;
  /** Pain-intensity heat colours: low (0-3), mid (4-6), high (7-10). */
  heat: { low: string; mid: string; high: string };
  /** Optional per-region base-colour overrides (region key → colour). */
  regions?: Record<string, string>;
  /**
   * Optional panel-chrome colours (the selection panel, labels, hint box) —
   * NOT the body itself. All optional; anything omitted falls back to
   * {@link defaultUi}. A palette that only themed the body was half a palette:
   * a consumer passing brand colours still got hardcoded chrome. (F052.19)
   */
  ui?: BodymapUiColors;
}

/** Panel-chrome colours. Every default is WCAG-AA (>=4.5:1) on its own background. */
export interface BodymapUiColors {
  /** Primary text (headings, values). */
  text?: string;
  /** Secondary text — section labels, the empty-state hint. */
  mutedText?: string;
  /** Panel background — the card, its buttons, the empty hint. */
  panelBg?: string;
  /**
   * THE STAGE: the fullscreen backdrop, the canvas frame, and the three.js
   * scene behind the body. A different surface from `panelBg` with an opposite
   * need — see F052.29, where one field paints both and no value is right for
   * either.
   *
   * 3D only. The 2D renderer has no canvas and no fullscreen, so it ignores
   * this; it is declared here because a stage is a shared idea, not because
   * every renderer has one.
   *
   * Defaults to {@link STAGE_BG}. Pass `'#fff'` for the pre-0.8.0 white
   * fullscreen backdrop.
   */
  stageBg?: string;
  /** Panel + control borders. */
  border?: string;
  /** Background behind the region-code badge. */
  badgeBg?: string;
  /** The destructive action (remove a marked region). */
  danger?: string;
}

/**
 * Default panel chrome. Contrast against `panelBg` (#fff), asserted by
 * `test/contrast.test.ts`:
 *   text       #1e293b  14.8:1
 *   mutedText  #475569   7.6:1  (was #94a3b8 at 2.56:1 — WCAG AA failure)
 *   danger     #dc2626   4.8:1  (was #ef4444 at 3.76:1 — WCAG AA failure)
 * `mutedText` on `badgeBg` (#f1f5f9) is 6.9:1 (was #64748b at 4.34:1).
 */
/**
 * The stage colour — the ONE place this value lives.
 *
 * It used to be a literal in three places in `three.tsx` (the three.js scene,
 * the canvas frame, the unsupported placeholder), which meant a consumer could
 * recolour the backdrop and still get OUR navy inside it. That seam is
 * invisible on a desktop and obvious on a phone. (F052.29)
 */
export const STAGE_BG = "#0e1424";

export const defaultUi: Required<BodymapUiColors> = {
  text: "#1e293b",
  mutedText: "#475569",
  panelBg: "#fff",
  stageBg: STAGE_BG,
  border: "#e2e8f0",
  badgeBg: "#f1f5f9",
  danger: "#dc2626",
};

/** Resolve a palette's chrome colours, filling every gap from {@link defaultUi}. */
export function uiColors(palette?: BodymapPalette): Required<BodymapUiColors> {
  return { ...defaultUi, ...(palette?.ui ?? {}) };
}

/** The fleet default palette. Override any field per consumer. */
export const defaultPalette: BodymapPalette = {
  body: "#d2d7de",
  hover: "#8fd0cd",
  selected: "#5cc4b7",
  heat: { low: "#fcd34d", mid: "#fb923c", high: "#ef4444" },
};

/** The heat colour for a pain intensity, honouring the palette. */
export function heatFor(intensity: number, palette: BodymapPalette = defaultPalette): string {
  return intensity >= 7 ? palette.heat.high : intensity >= 4 ? palette.heat.mid : palette.heat.low;
}

/** The base colour for a region (a per-region override, else the body colour). */
export function baseColorFor(regionKey: string, palette: BodymapPalette = defaultPalette): string {
  return palette.regions?.[regionKey] ?? palette.body;
}

// ---- bodymap/v1 serialization (the shared cross-app / native wire format) ---
//
// The shape every consumer + the native mobile apps read (aligned with
// fd-sundhed's bodymap/v1: region CODE + side + intensity + quality + view).
// The internal PainReport keys on the region KEY; this maps key -> clinical CODE
// so the report is portable and human-readable on the wire.

export type BodyView = "front" | "back" | "left" | "right";
/** Side in the serialized report — a midline region (no side) becomes "center". */
export type SerializedSide = "left" | "right" | "center";

export interface SerializedPainPoint {
  /** Clinical region CODE (e.g. "LUMB"). */
  region: string;
  side: SerializedSide;
  intensity: number;
  quality?: PainType;
}

export interface BodymapReportV1 {
  schema: "bodymap/v1";
  view: BodyView;
  points: SerializedPainPoint[];
}

export const bodymapReportV1Schema = z.object({
  schema: z.literal("bodymap/v1"),
  view: z.enum(["front", "back", "left", "right"]),
  points: z.array(
    z.object({
      region: z.string(),
      side: z.enum(["left", "right", "center"]),
      intensity: z.number().int().min(0).max(10),
      quality: z.enum(PAIN_TYPES).optional(),
    }),
  ),
});

/** Serialize a PainReport to the shared `bodymap/v1` wire format. */
export function serializeReport(
  report: PainReport,
  opts: { view?: BodyView } = {},
): BodymapReportV1 {
  return {
    schema: "bodymap/v1",
    view: opts.view ?? "front",
    points: report.map((p) => {
      const r = getRegion(p.region);
      return {
        region: r?.code ?? p.region,
        side: (r?.side ?? "center") as SerializedSide,
        intensity: p.intensity,
        quality: p.type,
      };
    }),
  };
}

/** Parse a `bodymap/v1` report back into an internal PainReport. Region CODE →
 *  key; a point whose code is unknown to this taxonomy is dropped. */
export function deserializeReport(
  env: unknown,
  now: () => string = () => new Date().toISOString(),
): PainReport {
  const parsed = bodymapReportV1Schema.parse(env);
  // code is side-less, so a point is identified by code + side.
  const byCodeSide = new Map(
    REGIONS.map((r) => [`${r.code}|${r.side ?? "center"}`, r.key] as const),
  );
  const out: PainReport = [];
  for (const sp of parsed.points) {
    const key = byCodeSide.get(`${sp.region}|${sp.side}`);
    if (!key) continue;
    out.push(
      painPointSchema.parse({
        region: key,
        intensity: sp.intensity,
        type: sp.quality,
        timestamp: now(),
      }),
    );
  }
  return out;
}

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

/** Whether a region may be marked. A hidden region is never selectable. */
export function isSelectable(key: string, config: RegionConfig = {}): boolean {
  const s = config[key];
  if (s?.visible === false) return false;
  return s?.selectable ?? true;
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

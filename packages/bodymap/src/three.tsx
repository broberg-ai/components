/**
 * @broberg/bodymap/three — a rotatable 3D body pain-map on the SAME core.
 *
 * `<BodyMap3D>` wraps a VANILLA three.js scene (NOT react-three-fiber, so it
 * runs in React, Preact and a Capacitor webview alike): a realistic Blender
 * Studio human base mesh (CC0), rotatable (drag) + zoomable (scroll), with
 * hover-highlight and click-to-mark — a click colours the body part by pain
 * intensity and produces the same structured PainReport (bodymap/v1) the 2D
 * renderer does. Region hit-testing is anchor-based: every mesh vertex is
 * assigned to its nearest region anchor (true per-zone mesh segmentation is a
 * later refinement — the wire + interaction are identical either way).
 *
 * `three` is an OPTIONAL peer — only consumers importing this subpath pull it
 * in. The body models are NOT bundled: pass `models={{ male, female }}` as URLs
 * you host (the package ships reference GLBs under `@broberg/bodymap/models/`).
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  REGIONS,
  PAIN_TYPES,
  getRegion,
  isSelectable,
  decidePick,
  type PickOutcome,
  emitFeedback,
  type FeedbackFn,
  serializeReport,
  heatFor,
  baseColorFor,
  defaultPalette,
  uiColors,
  type BodymapPalette,
  type PainReport,
  type PainType,
  type RegionConfig,
} from "./index.js";
import {
  LABELS_DA,
  LABELS_EN,
  type BodyMapLabels,
  type BodyMapLocale,
} from "./react.js";

export type BodyMap3DSex = "male" | "female";

/** URLs of the body GLB models the consumer hosts (reference GLBs ship under `@broberg/bodymap/models/`). */
export interface BodyMap3DModels {
  male: string;
  female: string;
}

/** The 3D-only control strings (the shared labels come from `locale`/`labels`). */
export interface BodyMap3DUiLabels {
  /** Label for the built-in fullscreen control (F052.24). */
  expand?: string;
  /** Label for the same control while fullscreen. */
  collapse?: string;
  male: string;
  female: string;
  hoverHint: string;
}

const UI_DA: BodyMap3DUiLabels = { male: "Mand", female: "Kvinde", hoverHint: "Hover for at fremhæve · klik en kropsdel for at markere smerte.", expand: "Vis stor", collapse: "Luk stor visning" };
const UI_EN: BodyMap3DUiLabels = { male: "Male", female: "Female", hoverHint: "Hover to highlight · tap a body part to mark pain.", expand: "Expand", collapse: "Close" };

// Region anchors in normalised body space (height ~1.9, feet y=0, front +z),
// then x-flipped so the patient's own left maps to "venstre" (self-view).
const ANCHORS: Record<string, [number, number, number]> = {
  head: [0, 1.79, 0.02], neck: [0, 1.57, 0.0],
  chest: [0, 1.42, 0.11], thora: [0, 1.42, -0.12], lumbar: [0, 1.13, -0.13], groin: [0, 0.92, 0.09],
  shoulder_left: [-0.2, 1.5, 0], shoulder_right: [0.2, 1.5, 0],
  uarm_left: [-0.27, 1.3, 0.0], uarm_right: [0.27, 1.3, 0.0],
  elbow_left: [-0.31, 1.08, 0], elbow_right: [0.31, 1.08, 0],
  farm_left: [-0.34, 0.93, 0.02], farm_right: [0.34, 0.93, 0.02],
  wrist_left: [-0.36, 0.79, 0.02], wrist_right: [0.36, 0.79, 0.02],
  hand_left: [-0.37, 0.68, 0.03], hand_right: [0.37, 0.68, 0.03],
  hip_left: [-0.14, 1.02, -0.03], hip_right: [0.14, 1.02, -0.03],
  thigh_left: [-0.1, 0.68, 0.05], thigh_right: [0.1, 0.68, 0.05],
  knee_left: [-0.1, 0.4, 0.06], knee_right: [0.1, 0.4, 0.06],
  lowleg_left: [-0.1, 0.22, 0.04], lowleg_right: [0.1, 0.22, 0.04],
  ankle_left: [-0.1, 0.05, 0.02], ankle_right: [0.1, 0.05, 0.02],
  foot_left: [-0.1, 0.02, 0.11], foot_right: [0.1, 0.02, 0.11],
};
/**
 * How much of the RUNNER-UP region bleeds into this vertex (F052.21).
 *
 * Takes SQUARED distances (what the assignment loop already has). Returns 0 at
 * an anchor and 0.5 where two anchors are equidistant — never above 0.5, so the
 * nearest region always dominates and a vertex can never be painted mostly as
 * its neighbour.
 *
 * `SEAM` decides how wide the fade is. Raised toward 1 the whole body turns to
 * mush and a marked region stops reading as a region; at 0 you get the old hard
 * plane back. It is a look, not a contract — hit-testing never sees this number.
 */
/** How wide the fade is, in ratio units below the seam. 0 = the old hard plane. */
const SEAM = 0.18;

/**
 * How much of the RUNNER-UP region bleeds into this vertex (F052.21).
 *
 * Takes SQUARED distances — what the assignment loop already has.
 *
 *   ratio = d1 / (d1 + d2)   → 0 at the anchor · 0.5 where two anchors are equidistant
 *
 * Returns 0 well inside a region and rises to 0.5 exactly at the seam, so the
 * nearest region ALWAYS dominates and a vertex can never be painted mostly as
 * its neighbour. Smoothstepped, so the fade has no visible start line of its own.
 *
 * This is a look, not a contract: hit-testing never sees this number, and the
 * PainReport is unchanged.
 */
export function seamBlend(nearestSq: number, secondSq: number): number {
  const d1 = Math.sqrt(nearestSq), d2 = Math.sqrt(secondSq);
  const sum = d1 + d2;
  if (!(sum > 0)) return 0;
  const ratio = d1 / sum;
  const t = (ratio - (0.5 - SEAM)) / SEAM;
  if (t <= 0) return 0;
  if (t >= 1) return 0.5;
  return t * t * (3 - 2 * t) * 0.5; // smoothstep
}

/**
 * F052.23 — how much of the NEIGHBOUR region's colour a vertex takes.
 *
 * Extracted from the paint loop for one reason: happy-dom cannot run WebGL, so
 * the fix that put the seam blend behind an opt-in had no automated guard at
 * all. A regression here is a WCAG failure on a public-health surface (measured:
 * 4.71:1 without the blend, 3.59:1 with it, averaged over a small mark), which
 * is not the kind of thing that should rely on someone re-measuring by hand.
 *
 * The invariant worth asserting is not "off returns 0 for this blend value" —
 * it is that off returns 0 for EVERY blend value, so the shipped default can
 * never mix body colour into a mark.
 */
export function seamWeight(seamEnabled: boolean, blend: number): number {
  return seamEnabled ? blend : 0;
}

/**
 * F052.25 — recompute vertex normals ONLY when the file shipped none.
 *
 * Same reason as above: this single condition WAS the "lines on the body" bug,
 * and it lived on the one code path the unit suite cannot execute. Takes a
 * structural slice rather than a THREE.BufferGeometry so it is testable without
 * a GL context.
 *
 * True means "this model has no normals, compute them or it renders flat".
 * False means "the file has normals — leave them alone", which is the case that
 * was broken.
 */
export function needsComputedNormals(geo: { getAttribute(name: string): unknown }): boolean {
  return !geo.getAttribute("normal");
}

const ANCHOR_KEYS = Object.keys(ANCHORS);
for (const k of ANCHOR_KEYS) ANCHORS[k][0] = -ANCHORS[k][0];

function mergeLabels(locale: BodyMapLocale, overrides?: Partial<BodyMapLabels>): BodyMapLabels {
  const base = locale === "en" ? LABELS_EN : LABELS_DA;
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    regions: { ...base.regions, ...overrides.regions },
    qualities: { ...base.qualities, ...overrides.qualities },
  };
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

export interface BodyMap3DProps {
  /** URLs of the male/female body GLBs (you host them; reference GLBs ship under `@broberg/bodymap/models/`). */
  models: BodyMap3DModels;
  value?: PainReport;
  defaultValue?: PainReport;
  onChange?: (report: PainReport) => void;
  /** Per-app region config — a non-selectable region is not pickable in 3D either. */
  config?: RegionConfig;
  palette?: BodymapPalette;
  locale?: BodyMapLocale;
  labels?: Partial<BodyMapLabels>;
  /** Override the 3D-only control strings (male/female/hoverHint). */
  ui?: Partial<BodyMap3DUiLabels>;
  defaultSex?: BodyMap3DSex;
  onSexChange?: (sex: BodyMap3DSex) => void;
  /** Controlled body type — when set, the parent owns it (e.g. from the user's profile); `onSexChange` still fires. */
  sex?: BodyMap3DSex;
  /** Show the Male/Female toggle (default true). Set false when `sex` comes from a profile and the picker would just be noise. */
  showSexToggle?: boolean;
  /** Slowly auto-rotate until the user interacts (default true). */
  autoRotate?: boolean;
  /** Height of the 3D canvas (default '60vh'). A bare number is treated as px. Set a
   *  shorter value on narrow viewports so the picker panel below the body stays visible
   *  the moment a region is selected (no full-screen scroll). */
  canvasHeight?: string | number;
  /** Show the clinical region-code badge (e.g. "HIP · right") in the panel header
   *  (default true). Set false for a patient/employee-facing flow where the code is
   *  internal jargon and the readable region name is enough. */
  showRegionCode?: boolean;
  /** Fill the viewport with the body (F052.24). Controlled: pass it and you own
   *  it; `onFullscreenChange` still fires so your own button can drive it.
   *
   *  This is a VIEWPORT FILL, not the browser Fullscreen API. iOS Safari does not
   *  support fullscreen on an arbitrary element at all, and the iPhone is this
   *  component's primary surface — so the mechanism that works everywhere is the
   *  one that ships, and it behaves identically on every platform. */
  fullscreen?: boolean;
  /** Fired when the built-in control or the Escape key changes it. */
  onFullscreenChange?: (fullscreen: boolean) => void;
  /** Show the built-in expand/collapse control (default true). Set false and
   *  drive `fullscreen` from your own button. */
  showFullscreenButton?: boolean;
  /** Soften the colour transition between neighbouring regions (F052.21).
   *
   *  DEFAULT FALSE, and the default is the accessible one (F052.23). The blend
   *  mixes the BODY colour into a marked region near its boundary — which on a
   *  SMALL mark is most of the mark. Measured on a phone with a consumer's
   *  palette and one knee marked: the mark's average contrast against the body
   *  fell from 4.71:1 to 3.59:1, i.e. below the WCAG AA threshold of 4.5:1, on a
   *  surface a public authority is legally required to meet.
   *
   *  At the single strongest pixel the cost is small (5.12 → 4.78) — which is
   *  why a spot-check misses it and the AVERAGE is what a person sees.
   *
   *  Turn it on when the marked areas are LARGE and you have no accessibility
   *  duty: the soft seam genuinely looks better there, and that is why it is
   *  still here rather than deleted. */
  seam?: boolean;
  /** Fired after every pick with what ACTUALLY happened (F052.22): "select",
   *  "clear" or "ignore". Wire it to a sound (`@broberg/soundkit`) or to native
   *  haptics (Capacitor `Haptics.impact()` — the only route to a real buzz on an
   *  iPhone, where web vibration does not exist). */
  onFeedback?: FeedbackFn;
  /** Web vibration on select/clear. Default true; silently inert where
   *  `navigator.vibrate` is absent (every browser on iPhone, most desktops).
   *  Set false to keep the signal but drop the buzz. */
  haptics?: boolean;
  className?: string;
}

const btn: React.CSSProperties = { font: "inherit", cursor: "pointer", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", padding: "6px 9px" };
const seg = (on: boolean): React.CSSProperties => ({ ...btn, background: on ? "#0e8f8a" : "#fff", color: on ? "#fff" : "#1e293b", fontWeight: 600 });

export function BodyMap3D(props: BodyMap3DProps) {
  const {
    models, value, defaultValue, onChange, config, palette = defaultPalette,
    locale = "da", labels, ui, defaultSex = "male", sex: sexProp, showSexToggle = true, onSexChange,
    autoRotate = true, canvasHeight = "60vh", showRegionCode = true,
    onFeedback, haptics, seam = false,
    fullscreen: fullscreenProp, onFullscreenChange, showFullscreenButton = true,
    className,
  } = props;

  // Panel chrome — consumer palette wins, AA-safe defaults fill every gap. (F052.19)
  const chrome = uiColors(palette);

  const L = mergeLabels(locale, labels);
  const UI = { ...(locale === "en" ? UI_EN : UI_DA), ...ui };
  const nameOf = (key: string) => L.regions[key] ?? getRegion(key)?.label ?? key;
  const canvasH = typeof canvasHeight === "number" ? `${canvasHeight}px` : canvasHeight;

  const mountRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<HTMLSpanElement>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [ready, setReady] = useState(false);
  const [internalSex, setInternalSex] = useState<BodyMap3DSex>(defaultSex);
  const sex = sexProp ?? internalSex; // controlled when `sex` is passed, else internal
  const [selected, setSelected] = useState<string | null>(null);
  const [internal, setInternal] = useState<PainReport>(defaultValue ?? []);
  const report = value ?? internal;

  const commit = (next: PainReport) => {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  };

  // Latest state visible to the once-mounted imperative scene.
  const reportRef = useRef(report); reportRef.current = report;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const paletteRef = useRef(palette); paletteRef.current = palette;
  const configRef = useRef(config); configRef.current = config;
  const modelsRef = useRef(models); modelsRef.current = models;
  const sexRef = useRef(sex); sexRef.current = sex;
  const setSelectedRef = useRef(setSelected); setSelectedRef.current = setSelected;
  // F052.20 — the pick DECISION, reachable from the once-mounted raycast handler.
  // Assigned below, after removePain exists.
  const pickRef = useRef<(key: string) => PickOutcome>(() => "ignore");
  const setReadyRef = useRef(setReady); setReadyRef.current = setReady;
  // The scene closure reads this at PAINT time, so toggling `seam` recolours
  // without rebuilding the model (F052.23).
  const seamRef = useRef(seam); seamRef.current = seam;
  // Controlled when `fullscreen` is passed, internal otherwise — same shape as
  // `sex` (F052.14), so a consumer can drive it from their own button.
  const [internalFs, setInternalFs] = useState(false);
  const isFullscreen = fullscreenProp ?? internalFs;
  const setFullscreen = (v: boolean) => {
    if (fullscreenProp === undefined) setInternalFs(v);
    onFullscreenChange?.(v);
  };
  const apiRef = useRef<{ setSex: (s: BodyMap3DSex) => void; refresh: () => void } | null>(null);

  useEffect(() => {
    if (!webglAvailable()) { setUnsupported(true); return; }
    const el = mountRef.current;
    if (!el) return;
    let W = el.clientWidth || 520, H = el.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1424);
    const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
    camera.position.set(0, 1.05, 4.4);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setUnsupported(true);
      return;
    }
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x223044, 1.05));
    const kl = new THREE.DirectionalLight(0xffffff, 1.5); kl.position.set(3, 5, 4); scene.add(kl);
    const rl = new THREE.DirectionalLight(0x88aaff, 0.7); rl.position.set(-4, 2, -3); scene.add(rl);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.autoRotate = autoRotate; controls.autoRotateSpeed = 1.1;
    controls.minDistance = 2.2; controls.maxDistance = 8; controls.enablePan = false;
    controls.target.set(0, 0.95, 0);
    controls.addEventListener("start", () => { controls.autoRotate = false; });

    // On-demand rendering: render only while auto-rotating or while damping is
    // still settling, then STOP — so the page goes idle. That saves battery on
    // mobile (bodymap is primarily a mobile surface) AND lets a headless
    // Lens/Playwright run actually land clicks instead of starving on a
    // never-quiet WebGL loop (fd-sundhed's F052.6-preview finding). A control
    // 'change' / interaction / state change kicks the pump back to life.
    let raf = 0;
    let pumping = false;
    const renderFrame = () => renderer.render(scene, camera);
    const pump = () => {
      const moved = controls.update();
      renderFrame();
      if (moved || controls.autoRotate) { raf = requestAnimationFrame(pump); }
      else { pumping = false; raf = 0; }
    };
    const kick = () => { if (!pumping && !document.hidden) { pumping = true; raf = requestAnimationFrame(pump); } };
    controls.addEventListener("change", kick);

    let modelRoot: THREE.Object3D | null = null;
    let bodyMesh: THREE.Mesh | null = null;
    // F052.21 — the hard assignment stays (it is what HIT-TESTING answers with);
    // `vertexNeighbour` + `vertexBlend` exist only so the COLOUR can fade at a
    // seam instead of stopping at a plane. A soft LOOK must never become a soft
    // ANSWER in a clinical record.
    let vertexRegion: string[] = [];
    let vertexNeighbour: string[] = [];
    let vertexBlend: Float32Array = new Float32Array(0);
    let colorAttr: THREE.BufferAttribute | null = null;
    let hovered: string | null = null;
    const loader = new GLTFLoader();
    const anchorVecs = ANCHOR_KEYS.map((k) => new THREE.Vector3(...ANCHORS[k]));
    const tmp = new THREE.Color();

    const restingHex = (key: string): string => {
      const pt = reportRef.current.find((p) => p.region === key);
      if (pt) return heatFor(pt.intensity, paletteRef.current);
      if (selectedRef.current === key) return paletteRef.current.selected;
      return baseColorFor(key, paletteRef.current);
    };
    const tmp2 = new THREE.Color();
    const colourOf = (key: string): string => (hovered === key ? paletteRef.current.hover : restingHex(key));

    /**
     * ONE pass over the vertices, blending the two nearest regions.
     *
     * The old paint walked every vertex once PER REGION (20x) and set a flat
     * colour, so a boundary was a hard plane through the mesh — the "sharp
     * transitions" Christian saw. It was never the model: 21,160 triangles with
     * smooth normals, and the body renders smooth in every screenshot.
     */
    const paint = () => {
      if (!colorAttr) return;
      const cache = new Map<string, THREE.Color>();
      const col = (k: string) => {
        let c = cache.get(k);
        if (!c) { c = new THREE.Color(colourOf(k)); cache.set(k, c); }
        return c;
      };
      for (let i = 0; i < vertexRegion.length; i++) {
        tmp.copy(col(vertexRegion[i]!));
        // Off by default: a blended mark is a LOWER-CONTRAST mark, and the
        // shipped default has to be the one that passes AA. (F052.23)
        const w = seamWeight(seamRef.current, vertexBlend[i]!);
        if (w > 0) { tmp2.copy(col(vertexNeighbour[i]!)); tmp.lerp(tmp2, w); }
        colorAttr.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      colorAttr.needsUpdate = true;
    };
    const refresh = () => { paint(); renderFrame(); };

    const loadModel = (which: BodyMap3DSex) => {
      const url = which === "female" ? modelsRef.current.female : modelsRef.current.male;
      loader.load(url, (gltf) => {
        if (modelRoot) scene.remove(modelRoot);
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); box.getSize(size);
        const center = new THREE.Vector3(); box.getCenter(center);
        const scale = 1.9 / size.y;
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        model.updateMatrixWorld(true);
        bodyMesh = null;
        model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !bodyMesh) bodyMesh = m; });
        if (bodyMesh) {
          const geo = (bodyMesh as THREE.Mesh).geometry as THREE.BufferGeometry;
          // F052.25 — DO NOT recompute normals when the file ships them.
          //
          // This one line was the "lines on the body, so it looks assembled"
          // Christian reported. computeVertexNormals() averages face normals PER
          // VERTEX INDEX, and this mesh has split vertices along its UV seams —
          // two copies at the same position, each averaging a different set of
          // faces. The result is a lighting discontinuity exactly along those
          // seams: a vertical line down the torso, horizontals at chest, waist,
          // knees, elbows, ankles. The GLB ships correct smooth normals; we were
          // throwing them away and reconstructing worse ones.
          //
          // Measured side by side, same page, same props, same viewport: with
          // the call, every one of those lines is visible; without it, none are.
          //
          // Kept as a FALLBACK only: a model with no normal attribute would
          // otherwise render flat/black, so compute them when — and only when —
          // the file did not provide any.
          if (needsComputedNormals(geo)) geo.computeVertexNormals();
          const pos = geo.getAttribute("position") as THREE.BufferAttribute;
          const n = pos.count;
          const cols = new Float32Array(n * 3);
          vertexRegion = new Array(n);
          vertexNeighbour = new Array(n);
          vertexBlend = new Float32Array(n);
          const v = new THREE.Vector3();
          for (let i = 0; i < n; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4((bodyMesh as THREE.Mesh).matrixWorld);
            // nearest AND runner-up, in one pass
            let best = 0, second = 0, bd = Infinity, sd = Infinity;
            for (let a = 0; a < anchorVecs.length; a++) {
              const d = v.distanceToSquared(anchorVecs[a]);
              if (d < bd) { sd = bd; second = best; bd = d; best = a; }
              else if (d < sd) { sd = d; second = a; }
            }
            vertexRegion[i] = ANCHOR_KEYS[best]!;
            vertexNeighbour[i] = ANCHOR_KEYS[second]!;
            vertexBlend[i] = seamBlend(bd, sd);
          }
          colorAttr = new THREE.BufferAttribute(cols, 3);
          geo.setAttribute("color", colorAttr);
          (bodyMesh as THREE.Mesh).material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.04 });
          refresh();
        }
        modelRoot = model;
        scene.add(model);
        renderFrame();
        kick();
        setReadyRef.current(true);
        if (loadedRef.current) { loadedRef.current.setAttribute("data-loaded", "true"); loadedRef.current.setAttribute("data-model", which); }
      });
    };
    loadModel(sexRef.current);
    apiRef.current = {
      setSex: (s) => { loadedRef.current?.removeAttribute("data-loaded"); setReadyRef.current(false); loadModel(s); },
      refresh,
    };

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (clientX: number, clientY: number): string | null => {
      if (!bodyMesh) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(bodyMesh, true);
      if (!hits.length) return null;
      const p = hits[0].point;
      // Nearest SELECTABLE anchor — a region hidden/locked by the per-app config
      // is skipped, so it never highlights or gets picked (2D-parity).
      let best: string | null = null, bd = Infinity;
      for (const k of ANCHOR_KEYS) {
        if (!isSelectable(k, configRef.current ?? {})) continue;
        const a = ANCHORS[k];
        const d = (p.x - a[0]) ** 2 + (p.y - a[1]) ** 2 + (p.z - a[2]) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    };

    let downX = 0, downY = 0, downT = 0;
    const canvas = renderer.domElement;
    const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; downT = Date.now(); };
    const onMove = (e: PointerEvent) => {
      if ((e.buttons || 0) !== 0) return;
      const k = pick(e.clientX, e.clientY);
      if (k === hovered) return;
      hovered = k;
      // One pass over the vertices repaints everything, including both seams the
      // hover just moved across — a per-region repaint cannot, now that a vertex
      // can carry colour from TWO regions.
      paint();
      canvas.style.cursor = k ? "pointer" : "default";
      renderFrame();
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || Date.now() - downT > 450) return;
      const k = pick(e.clientX, e.clientY);
      if (!k) return;
      const outcome = pickRef.current(k);
      // A CLEARED REGION MUST NOT KEEP ITS HIGHLIGHT (F052.20).
      //
      // `refresh()` deliberately preserves the hover colour on `hovered`, so
      // after a removal the region stayed highlighted and looked exactly like it
      // was still marked. Measured on an iPhone viewport: report correctly
      // `points: []`, panel closed, chest still turquoise. A finger leaves no
      // cursor behind, so nothing ever moved away to clear it — the user would
      // tap again and mark it a second time.
      //
      // Dropped unconditionally rather than only for touch: showing a highlight
      // on something the user just deleted is wrong feedback in every input
      // mode, and on a mouse the very next pointermove puts it straight back.
      if (outcome === "clear") {
        hovered = null;
        canvas.style.cursor = "default";
      }
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);

    renderFrame();
    kick(); // settle initial damping / start auto-rotate if enabled
    const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); pumping = false; raf = 0; } else kick(); };
    document.addEventListener("visibilitychange", onVis);
    const onResize = () => { W = el.clientWidth || 520; H = el.clientHeight || 600; camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H); renderFrame(); };
    window.addEventListener("resize", onResize);
    /**
     * F052.24 — the ELEMENT can change size without the WINDOW doing so, and
     * before this the canvas kept whatever size it was measured at on mount.
     * Every way that happens is ordinary, not exotic:
     *   · entering/leaving fullscreen (this card's whole feature)
     *   · a consumer switching `canvasHeight` at a breakpoint
     *   · a container animating open, or a step/wizard revealing the panel
     *   · a phone's URL bar collapsing, which changes what `vh` means
     * A stale size shows as a body that is small, off-centre, or clipped — with
     * nothing to see in the code, because the camera maths is correct and the
     * numbers it was given are old.
     */
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => onResize()) : null;
    ro?.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      controls.removeEventListener("change", kick);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape leaves fullscreen — a viewport-filling overlay with no keyboard way
  // out is a trap, and F052.11 made this component's accessibility a legal duty.
  useEffect(() => {
    if (!isFullscreen && !selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Innermost first: Escape closes the open region before it leaves
      // fullscreen, so one press never does two things at once. (F052.26)
      if (selected) setSelected(null);
      else setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // React → scene: recolour on selection / report / palette change; swap model on sex change.
  useEffect(() => { apiRef.current?.refresh(); }, [selected, report, palette, seam]);
  // Swap the model on sex change — but skip the first run: the mount effect
  // already loaded sexRef.current, so this avoids a redundant reload (matters on mobile).
  const sexInited = useRef(false);
  useEffect(() => {
    if (!sexInited.current) { sexInited.current = true; return; }
    apiRef.current?.setSex(sex);
  }, [sex]);

  const pointOf = (k: string) => report.find((p) => p.region === k);
  const setPain = (k: string, intensity: number, type?: PainType) => {
    commit([...report.filter((p) => p.region !== k), { region: k, intensity, type, timestamp: new Date().toISOString() }]);
  };
  const removePain = (k: string) => { commit(report.filter((p) => p.region !== k)); setSelected(null); };
  /**
   * F052.20 — a region that is ALREADY marked is CLEARED by picking it again.
   * The 2D renderer has the identical rule in `applyPick`; they share no click
   * code, which is exactly why both are asserted separately.
   */
  pickRef.current = (k: string): PickOutcome => {
    const what = decidePick(k, reportRef.current, configRef.current ?? {});
    // Same call as the 2D renderer, from the same decision — the signal cannot
    // drift between the two bodies because neither of them decides it. (F052.22)
    emitFeedback(what, k, { onFeedback, haptics });
    if (what === "clear") removePain(k);
    else if (what === "select") setSelected(k);
    return what;
  };
  const changeSex = (s: BodyMap3DSex) => { if (sexProp === undefined) setInternalSex(s); onSexChange?.(s); };

  const region = selected ? REGIONS.find((r) => r.key === selected) : null;
  const current = selected ? pointOf(selected) : undefined;
  // Smart default: when the config locks EVERYTHING (a report/display view), the
  // "tap a body part to mark pain" hint is misleading — suppress it unless the
  // consumer explicitly set a display text via ui.hoverHint.
  const anySelectable = REGIONS.some((r) => isSelectable(r.key, config ?? {}));
  const showEmptyHint = anySelectable || ui?.hoverHint !== undefined;

  return (
    <div
      data-testid="bodymap3d-root"
      className={className}
      data-fullscreen={isFullscreen ? "true" : undefined}
      style={{
        fontFamily: "system-ui, sans-serif",
        color: "#1e293b",
        // A viewport fill, not the Fullscreen API — see the `fullscreen` prop.
        // `fixed`+`inset:0` behaves the same on iOS Safari, where element
        // fullscreen does not exist at all, as it does everywhere else.
        ...(isFullscreen
          ? {
              position: "fixed" as const,
              inset: 0,
              zIndex: 2147483000,
              background: chrome.panelBg,
              // F052.27 — a fixed inset:0 surface in a standalone/Capacitor
              // webview covers the STATUS BAR too, so a control laid out at the
              // top lands on the clock and the battery. Measured by fd-sundhed
              // on a real iPhone: the owner could not read the button or get
              // out, and Escape does not exist on a phone. Every side gets its
              // safe-area inset, bottom included — the home indicator covers
              // content just as effectively.
              paddingTop: "calc(12px + env(safe-area-inset-top))",
              paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
              paddingLeft: "calc(12px + env(safe-area-inset-left))",
              paddingRight: "calc(12px + env(safe-area-inset-right))",
              display: "flex",
              flexDirection: "column" as const,
              overflow: "auto" as const,
            }
          : null),
      }}
    >
      {showSexToggle && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button data-testid="bodymap3d-sex-male" onClick={() => changeSex("male")} style={seg(sex === "male")}>{UI.male}</button>
            <button data-testid="bodymap3d-sex-female" onClick={() => changeSex("female")} style={seg(sex === "female")}>{UI.female}</button>
          </div>
        </div>
      )}
      <span ref={loadedRef} data-testid="bodymap3d-loaded" style={{ display: "none" }} />
      {ready && <span data-testid="bodymap3d-ready" style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />}
      {showFullscreenButton && !unsupported && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button
            type="button"
            data-testid="bodymap3d-fullscreen"
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? (UI.collapse ?? "Close") : (UI.expand ?? "Expand")}
            onClick={() => setFullscreen(!isFullscreen)}
            style={{
              ...btn,
              color: chrome.text,
              borderColor: chrome.border,
              background: chrome.panelBg,
              ...(isFullscreen ? { width: 40, height: 40, padding: 0, fontSize: 22, lineHeight: 1 } : null),
            }}
          >
            {/* A COMPACT × once we are the whole screen. The text pill is
                right when the component sits in a page — it is discoverable —
                and wrong at the top of a phone screen, where it is wide enough
                to cover half the status bar. The label stays on aria-label, so
                nothing is lost for a screen reader. (F052.27) */}
            {isFullscreen ? "×" : (UI.expand ?? "Expand")}
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap", ...(isFullscreen ? { flex: "1 1 auto", minHeight: 0 } : null) }}>
        {unsupported ? (
          <div data-testid="bodymap3d-unsupported" style={{ flex: "1 1 520px", minWidth: 320, height: canvasH, borderRadius: 16, background: "#0e1424", color: "#cbd5e1", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontSize: 14 }}>
            3D kræver WebGL, som ikke er tilgængeligt her.
          </div>
        ) : (
          <div
            ref={mountRef}
            data-testid="bodymap3d-canvas"
            style={{
              flex: "1 1 520px",
              // In fullscreen the box takes the height it is GIVEN rather than a
              // fixed `canvasHeight`; the ResizeObserver above is what makes the
              // picture follow it.
              height: isFullscreen ? "100%" : canvasH,
              minWidth: 320,
              minHeight: isFullscreen ? 0 : undefined,
              borderRadius: 16,
              overflow: "hidden",
              background: "#0e1424",
              touchAction: "none",
            }}
          />
        )}
        <div style={{ flex: "1 1 300px", minWidth: 260 }}>
          {region ? (
            <div style={{ border: `1px solid ${chrome.border}`, borderRadius: 14, padding: 16, background: chrome.panelBg }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <b style={{ fontSize: 16 }}>{nameOf(region.key)}</b>
                {showRegionCode && (
                  <span data-testid="bodymap3d-region-code" style={{ font: "11px ui-monospace, monospace", color: chrome.mutedText, background: chrome.badgeBg, borderRadius: 6, padding: "2px 7px" }}>{region.code}{region.side ? " · " + region.side : ""}</span>
                )}
                {/* F052.26 — the way OUT. Opening a region writes nothing, so
                    until now there was no exit that did not write something:
                    mark it, or open a different region you did not mean either.
                    Always shown, not only when nothing is marked — closing is
                    "stop editing this region", a different act from removing
                    the mark. Both renderers get it: this package has been
                    bitten three times today by fixing one half of a pair. */}
                <button
                  type="button"
                  data-testid="bodymap3d-close"
                  aria-label={L.close}
                  onClick={() => setSelected(null)}
                  style={{ ...btn, width: 32, height: 32, padding: 0, fontSize: 20, lineHeight: 1, color: chrome.mutedText, borderColor: chrome.border, background: chrome.panelBg }}
                >×</button>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: chrome.mutedText, marginBottom: 7 }}>{L.intensity}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                {Array.from({ length: 11 }, (_, i) => (
                  <button key={i} data-testid={`bodymap3d-intensity-${i}`} onClick={() => setPain(region.key, i, current?.type)} style={{ ...btn, display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 30, height: 30, padding: 0, background: current?.intensity === i ? "#0e8f8a" : "#fff", color: current?.intensity === i ? "#fff" : "#1e293b" }}>{i}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: chrome.mutedText, marginBottom: 7 }}>{L.quality}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {PAIN_TYPES.map((t) => (
                  <button key={t} data-testid={`bodymap3d-type-${t}`} onClick={() => setPain(region.key, current?.intensity ?? 5, t)} style={{ ...btn, borderRadius: 999, padding: "6px 12px", background: current?.type === t ? "#1e293b" : "#fff", color: current?.type === t ? "#fff" : "#64748b" }}>{L.qualities[t] ?? t}</button>
                ))}
              </div>
              {current && <button data-testid="bodymap3d-remove" onClick={() => removePain(region.key)} style={{ ...btn, color: chrome.danger, borderColor: "#f6c9c9" }}>{L.remove}</button>}
            </div>
          ) : showEmptyHint ? (
            <div data-testid="bodymap3d-empty" style={{ border: `1px solid ${chrome.border}`, borderRadius: 14, padding: 16, background: chrome.panelBg, color: chrome.mutedText, fontSize: 13.5 }}>{UI.hoverHint}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Re-export for convenience so a 3D-only consumer can serialize without a second import. */
export { serializeReport };

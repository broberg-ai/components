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
  serializeReport,
  heatFor,
  baseColorFor,
  defaultPalette,
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
  male: string;
  female: string;
  hoverHint: string;
}

const UI_DA: BodyMap3DUiLabels = { male: "Mand", female: "Kvinde", hoverHint: "Hover for at fremhæve · klik en kropsdel for at markere smerte." };
const UI_EN: BodyMap3DUiLabels = { male: "Male", female: "Female", hoverHint: "Hover to highlight · tap a body part to mark pain." };

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
  className?: string;
}

const btn: React.CSSProperties = { font: "inherit", cursor: "pointer", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", padding: "6px 9px" };
const seg = (on: boolean): React.CSSProperties => ({ ...btn, background: on ? "#0e8f8a" : "#fff", color: on ? "#fff" : "#1e293b", fontWeight: 600 });

export function BodyMap3D(props: BodyMap3DProps) {
  const {
    models, value, defaultValue, onChange, config, palette = defaultPalette,
    locale = "da", labels, ui, defaultSex = "male", sex: sexProp, showSexToggle = true, onSexChange,
    autoRotate = true, canvasHeight = "60vh", className,
  } = props;

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
  const setReadyRef = useRef(setReady); setReadyRef.current = setReady;
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
    let vertexRegion: string[] = [];
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
    const colorRegion = (key: string, hex: string) => {
      if (!colorAttr) return;
      tmp.set(hex);
      for (let i = 0; i < vertexRegion.length; i++) if (vertexRegion[i] === key) colorAttr.setXYZ(i, tmp.r, tmp.g, tmp.b);
      colorAttr.needsUpdate = true;
    };
    const refresh = () => { for (const k of ANCHOR_KEYS) colorRegion(k, hovered === k ? paletteRef.current.hover : restingHex(k)); renderFrame(); };

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
          geo.computeVertexNormals();
          const pos = geo.getAttribute("position") as THREE.BufferAttribute;
          const n = pos.count;
          const cols = new Float32Array(n * 3);
          vertexRegion = new Array(n);
          const v = new THREE.Vector3();
          for (let i = 0; i < n; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4((bodyMesh as THREE.Mesh).matrixWorld);
            let best = 0, bd = Infinity;
            for (let a = 0; a < anchorVecs.length; a++) { const d = v.distanceToSquared(anchorVecs[a]); if (d < bd) { bd = d; best = a; } }
            vertexRegion[i] = ANCHOR_KEYS[best];
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
      const prev = hovered; hovered = k;
      if (prev) colorRegion(prev, restingHex(prev));
      if (k) colorRegion(k, paletteRef.current.hover);
      canvas.style.cursor = k ? "pointer" : "default";
      renderFrame();
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || Date.now() - downT > 450) return;
      const k = pick(e.clientX, e.clientY);
      if (k) setSelectedRef.current(k);
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

    return () => {
      cancelAnimationFrame(raf);
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

  // React → scene: recolour on selection / report / palette change; swap model on sex change.
  useEffect(() => { apiRef.current?.refresh(); }, [selected, report, palette]);
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
  const changeSex = (s: BodyMap3DSex) => { if (sexProp === undefined) setInternalSex(s); onSexChange?.(s); };

  const region = selected ? REGIONS.find((r) => r.key === selected) : null;
  const current = selected ? pointOf(selected) : undefined;
  // Smart default: when the config locks EVERYTHING (a report/display view), the
  // "tap a body part to mark pain" hint is misleading — suppress it unless the
  // consumer explicitly set a display text via ui.hoverHint.
  const anySelectable = REGIONS.some((r) => isSelectable(r.key, config ?? {}));
  const showEmptyHint = anySelectable || ui?.hoverHint !== undefined;

  return (
    <div data-testid="bodymap3d-root" className={className} style={{ fontFamily: "system-ui, sans-serif", color: "#1e293b" }}>
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
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        {unsupported ? (
          <div data-testid="bodymap3d-unsupported" style={{ flex: "1 1 520px", minWidth: 320, height: canvasH, borderRadius: 16, background: "#0e1424", color: "#cbd5e1", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontSize: 14 }}>
            3D kræver WebGL, som ikke er tilgængeligt her.
          </div>
        ) : (
          <div ref={mountRef} data-testid="bodymap3d-canvas" style={{ flex: "1 1 520px", height: canvasH, minWidth: 320, borderRadius: 16, overflow: "hidden", background: "#0e1424", touchAction: "none" }} />
        )}
        <div style={{ flex: "1 1 300px", minWidth: 260 }}>
          {region ? (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <b style={{ fontSize: 16 }}>{nameOf(region.key)}</b>
                <span style={{ font: "11px ui-monospace, monospace", color: "#64748b", background: "#f1f5f9", borderRadius: 6, padding: "2px 7px" }}>{region.code}{region.side ? " · " + region.side : ""}</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 7 }}>{L.intensity}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                {Array.from({ length: 11 }, (_, i) => (
                  <button key={i} data-testid={`bodymap3d-intensity-${i}`} onClick={() => setPain(region.key, i, current?.type)} style={{ ...btn, display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 30, height: 30, padding: 0, background: current?.intensity === i ? "#0e8f8a" : "#fff", color: current?.intensity === i ? "#fff" : "#1e293b" }}>{i}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 7 }}>{L.quality}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {PAIN_TYPES.map((t) => (
                  <button key={t} data-testid={`bodymap3d-type-${t}`} onClick={() => setPain(region.key, current?.intensity ?? 5, t)} style={{ ...btn, borderRadius: 999, padding: "6px 12px", background: current?.type === t ? "#1e293b" : "#fff", color: current?.type === t ? "#fff" : "#64748b" }}>{L.qualities[t] ?? t}</button>
                ))}
              </div>
              {current && <button data-testid="bodymap3d-remove" onClick={() => removePain(region.key)} style={{ ...btn, color: "#ef4444", borderColor: "#f6c9c9" }}>{L.remove}</button>}
            </div>
          ) : showEmptyHint ? (
            <div data-testid="bodymap3d-empty" style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, background: "#fff", color: "#94a3b8", fontSize: 13.5 }}>{UI.hoverHint}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Re-export for convenience so a 3D-only consumer can serialize without a second import. */
export { serializeReport };

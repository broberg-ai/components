// 3D demo (F052.6 preview) — realistic Blender Studio body (CC0), rotatable,
// clickable, pain-coloured, with hover-highlight, a male/female switch and
// consumer-controllable palette (the SDK's BodymapPalette).
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  REGIONS, PAIN_TYPES, serializeReport, heatFor, baseColorFor, defaultPalette,
  type BodymapPalette, type PainReport, type PainType,
} from "../src/index";

// Region anchors in normalised body space (height ~1.9, feet y=0, front +z).
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
// The Blender body faces +Z, so the PATIENT's left is at +X. Anchor literals
// were authored with "left" at -X (self-view/mirror); flip x so L/R follows the
// patient's own point of view (patient's left → "venstre").
for (const k of ANCHOR_KEYS) ANCHORS[k][0] = -ANCHORS[k][0];

const PALETTES: Record<string, BodymapPalette> = {
  Standard: defaultPalette,
  "AK-brand": { body: "#c8ccdd", hover: "#5CC4B7", selected: "#141969", heat: { low: "#FFE049", mid: "#F09A3E", high: "#D61C64" } },
  Varm: { body: "#e2d8d0", hover: "#f6c667", selected: "#e26d6d", heat: { low: "#fcd34d", mid: "#fb923c", high: "#ef4444" } },
};

function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [sex, setSex] = useState<"male" | "female">(
    new URLSearchParams(window.location.search).get("sex") === "female" ? "female" : "male",
  );
  const [paletteName, setPaletteName] = useState("Standard");
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<PainReport>([]);

  const palette = PALETTES[paletteName];
  // refs so the (once-mounted) scene reads current state
  const reportRef = useRef(report); reportRef.current = report;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const paletteRef = useRef(palette); paletteRef.current = palette;
  const apiRef = useRef<{ setSex: (s: "male" | "female") => void; refresh: () => void } | null>(null);

  useEffect(() => {
    const el = mountRef.current!;
    let W = el.clientWidth, H = el.clientHeight || 600;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1424);
    const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
    camera.position.set(0, 1.05, 4.4);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x223044, 1.05));
    const kl = new THREE.DirectionalLight(0xffffff, 1.5); kl.position.set(3, 5, 4); scene.add(kl);
    const rl = new THREE.DirectionalLight(0x88aaff, 0.7); rl.position.set(-4, 2, -3); scene.add(rl);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    const STATIC = new URLSearchParams(window.location.search).has("static");
    controls.autoRotate = !STATIC; controls.autoRotateSpeed = 1.1;
    controls.minDistance = 2.2; controls.maxDistance = 8; controls.enablePan = false;
    controls.target.set(0, 0.95, 0);
    controls.addEventListener("start", () => { controls.autoRotate = false; });

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
    const refresh = () => { for (const k of ANCHOR_KEYS) colorRegion(k, hovered === k ? paletteRef.current.hover : restingHex(k)); };

    const loadModel = (which: "male" | "female") => {
      loader.load(which === "female" ? "./body-female.glb" : "./body-male.glb", (gltf) => {
        if (modelRoot) { scene.remove(modelRoot); }
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
          geo.computeVertexNormals(); // force smooth shading (the female base exports flat-shaded)
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
        const flag = document.getElementById("loaded"); if (flag) { flag.setAttribute("data-loaded", "true"); flag.setAttribute("data-model", which); }
      });
    };
    loadModel("male");
    apiRef.current = { setSex: (s) => { const f = document.getElementById("loaded"); if (f) f.removeAttribute("data-loaded"); loadModel(s); }, refresh };

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
      let best = ANCHOR_KEYS[0], bd = Infinity;
      for (const k of ANCHOR_KEYS) { const a = ANCHORS[k]; const d = (p.x - a[0]) ** 2 + (p.y - a[1]) ** 2 + (p.z - a[2]) ** 2; if (d < bd) { bd = d; best = k; } }
      return best;
    };

    let downX = 0, downY = 0, downT = 0;
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; downT = Date.now(); });
    canvas.addEventListener("pointermove", (e) => {
      if ((e.buttons || 0) !== 0) return; // dragging → skip hover
      const k = pick(e.clientX, e.clientY);
      if (k === hovered) return;
      const prev = hovered; hovered = k;
      if (prev) colorRegion(prev, restingHex(prev));
      if (k) colorRegion(k, paletteRef.current.hover);
      canvas.style.cursor = k ? "pointer" : "default";
    });
    canvas.addEventListener("pointerup", (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || Date.now() - downT > 450) return;
      const k = pick(e.clientX, e.clientY);
      if (k) setSelected(k);
    });

    let raf = 0;
    const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
    tick();
    const onResize = () => { W = el.clientWidth; H = el.clientHeight || 600; camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); renderer.dispose(); if (canvas.parentNode) canvas.parentNode.removeChild(canvas); };
  }, []);

  // React → scene: recolour whenever selection / report / palette changes
  useEffect(() => { apiRef.current?.refresh(); }, [selected, report, paletteName]);
  // React → scene: swap the model on sex change
  useEffect(() => { apiRef.current?.setSex(sex); }, [sex]);

  const pointOf = (k: string) => report.find((p) => p.region === k);
  const setPain = (k: string, intensity: number, type?: PainType) => {
    setReport([...report.filter((p) => p.region !== k), { region: k, intensity, type, timestamp: new Date().toISOString() }]);
  };
  const removePain = (k: string) => { setReport(report.filter((p) => p.region !== k)); setSelected(null); };

  const region = selected ? REGIONS.find((r) => r.key === selected) : null;
  const current = selected ? pointOf(selected) : undefined;
  const btn: React.CSSProperties = { font: "inherit", cursor: "pointer", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", padding: "6px 9px" };
  const seg = (on: boolean): React.CSSProperties => ({ ...btn, background: on ? "#0e8f8a" : "#fff", color: on ? "#fff" : "#1e293b", fontWeight: 600 });

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#1e293b" }}>
      <h1 style={{ fontSize: 21, marginBottom: 6 }}>@broberg/bodymap — 3D (Blender Studio · CC0)</h1>
      <p style={{ color: "#64748b", marginBottom: 12, fontSize: 14 }}>
        <b>Træk</b> roter · <b>scroll</b> zoom · <b>hover</b> fremhæver · <b>klik</b> en kropsdel → sæt intensitet → farves efter smerten.
      </p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14, fontSize: 13 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Krop</span>
          <button data-testid="bodymap3d-sex-male" onClick={() => setSex("male")} style={seg(sex === "male")}>Mand</button>
          <button data-testid="bodymap3d-sex-female" onClick={() => setSex("female")} style={seg(sex === "female")}>Kvinde</button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Palette</span>
          {Object.keys(PALETTES).map((p) => (
            <button key={p} data-testid={`bodymap3d-palette-${p}`} onClick={() => setPaletteName(p)} style={seg(paletteName === p)}>{p}</button>
          ))}
        </div>
      </div>
      <span id="loaded" data-testid="bodymap3d-loaded" style={{ display: "none" }} />
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div ref={mountRef} data-testid="bodymap3d-canvas" style={{ flex: "1 1 520px", height: "68vh", minWidth: 320, borderRadius: 16, overflow: "hidden", background: "#0e1424" }} />
        <div style={{ flex: "1 1 300px", minWidth: 260 }}>
          {region ? (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <b style={{ fontSize: 16 }}>{region.label}</b>
                <span style={{ font: "11px ui-monospace, monospace", color: "#64748b", background: "#f1f5f9", borderRadius: 6, padding: "2px 7px" }}>{region.code}{region.side ? " · " + region.side : ""}</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 7 }}>Intensitet (0-10)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                {Array.from({ length: 11 }, (_, i) => (
                  <button key={i} data-testid={`bodymap3d-intensity-${i}`} onClick={() => setPain(region.key, i, current?.type)} style={{ ...btn, width: 30, height: 30, background: current?.intensity === i ? "#0e8f8a" : "#fff", color: current?.intensity === i ? "#fff" : "#1e293b" }}>{i}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 7 }}>Kvalitet</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {PAIN_TYPES.map((t) => (
                  <button key={t} data-testid={`bodymap3d-type-${t}`} onClick={() => setPain(region.key, current?.intensity ?? 5, t)} style={{ ...btn, borderRadius: 999, padding: "6px 12px", background: current?.type === t ? "#1e293b" : "#fff", color: current?.type === t ? "#fff" : "#64748b" }}>{t}</button>
                ))}
              </div>
              {current && <button data-testid="bodymap3d-remove" onClick={() => removePain(region.key)} style={{ ...btn, color: "#ef4444", borderColor: "#f6c9c9" }}>Fjern punkt</button>}
            </div>
          ) : (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, background: "#fff", color: "#94a3b8", fontSize: 13.5 }}>Hover for at fremhæve · klik en kropsdel for at markere smerte.</div>
          )}
          <pre data-testid="bodymap3d-json" style={{ marginTop: 14, background: "#0f172a", color: "#cbd5e1", padding: 13, borderRadius: 10, fontSize: 11.5, overflowX: "auto" }}>
            {JSON.stringify(serializeReport(report), null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

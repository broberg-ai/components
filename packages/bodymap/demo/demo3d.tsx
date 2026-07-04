// 3D demo (F052.6 preview) — the realistic Blender Studio body (CC0), rotatable,
// with CLICKABLE region zones that colour the body part by pain intensity.
//
// The model is one mesh (not pre-segmented), so we assign every vertex to its
// nearest region ANCHOR once; a click raycasts to a body point → nearest region
// → the picker sets intensity → that region's vertices get the heat colour
// (yellow→orange→red). Output is the same bodymap/v1 as the 2D renderer.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { REGIONS, PAIN_TYPES, serializeReport, type PainReport, type PainType } from "../src/index";

// Region anchors in the normalised body space (height ~1.9, feet at y=0, front +z).
const ANCHORS: Record<string, [number, number, number]> = {
  head: [0, 1.78, 0.02], neck: [0, 1.56, 0.0],
  chest: [0, 1.35, 0.1], thora: [0, 1.38, -0.11], lumbar: [0, 1.08, -0.12], groin: [0, 0.95, 0.08],
  shoulder_left: [-0.2, 1.48, 0], shoulder_right: [0.2, 1.48, 0],
  uarm_left: [-0.27, 1.28, 0], uarm_right: [0.27, 1.28, 0],
  elbow_left: [-0.31, 1.06, 0], elbow_right: [0.31, 1.06, 0],
  farm_left: [-0.34, 0.92, 0.02], farm_right: [0.34, 0.92, 0.02],
  wrist_left: [-0.36, 0.78, 0.02], wrist_right: [0.36, 0.78, 0.02],
  hand_left: [-0.37, 0.68, 0.03], hand_right: [0.37, 0.68, 0.03],
  hip_left: [-0.13, 0.98, -0.02], hip_right: [0.13, 0.98, -0.02],
  thigh_left: [-0.1, 0.68, 0.05], thigh_right: [0.1, 0.68, 0.05],
  knee_left: [-0.1, 0.4, 0.06], knee_right: [0.1, 0.4, 0.06],
  lowleg_left: [-0.1, 0.22, 0.04], lowleg_right: [0.1, 0.22, 0.04],
  ankle_left: [-0.1, 0.05, 0.02], ankle_right: [0.1, 0.05, 0.02],
  foot_left: [-0.1, 0.02, 0.1], foot_right: [0.1, 0.02, 0.1],
};
const ANCHOR_KEYS = Object.keys(ANCHORS);
const BASE = new THREE.Color(0.82, 0.85, 0.9);
function heatColor(v: number): THREE.Color {
  return new THREE.Color(v >= 7 ? 0xef4444 : v >= 4 ? 0xfb923c : 0xfcd34d);
}

interface SceneApi { recolor: (regionKey: string, color: THREE.Color) => void }

function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<PainReport>([]);

  useEffect(() => {
    const el = mountRef.current!;
    let W = el.clientWidth, H = el.clientHeight || 600;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1424);
    const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
    camera.position.set(0, 1.05, 4.4);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x223044, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(3, 5, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.7); rim.position.set(-4, 2, -3); scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.autoRotate = true; controls.autoRotateSpeed = 1.2;
    controls.minDistance = 2.2; controls.maxDistance = 8; controls.enablePan = false;
    controls.target.set(0, 0.95, 0);
    controls.addEventListener("start", () => { controls.autoRotate = false; });

    let bodyMesh: THREE.Mesh | null = null;
    let vertexRegion: string[] = [];
    let colorAttr: THREE.BufferAttribute | null = null;

    apiRef.current = {
      recolor(regionKey, color) {
        if (!colorAttr) return;
        for (let i = 0; i < vertexRegion.length; i++) {
          if (vertexRegion[i] === regionKey) colorAttr.setXYZ(i, color.r, color.g, color.b);
        }
        colorAttr.needsUpdate = true;
      },
    };

    const loader = new GLTFLoader();
    loader.load("./body.glb", (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      const scale = 1.9 / size.y;
      model.scale.setScalar(scale);
      model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      model.updateMatrixWorld(true);
      model.traverse((o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !bodyMesh) bodyMesh = m;
      });
      if (bodyMesh) {
        const geo = bodyMesh.geometry as THREE.BufferGeometry;
        const pos = geo.getAttribute("position") as THREE.BufferAttribute;
        const n = pos.count;
        const cols = new Float32Array(n * 3);
        vertexRegion = new Array(n);
        const anchorVecs = ANCHOR_KEYS.map((k) => {
          const a = ANCHORS[k];
          return new THREE.Vector3(a[0], a[1], a[2]);
        });
        const v = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(bodyMesh.matrixWorld);
          let best = 0, bestD = Infinity;
          for (let a = 0; a < anchorVecs.length; a++) {
            const d = v.distanceToSquared(anchorVecs[a]);
            if (d < bestD) { bestD = d; best = a; }
          }
          vertexRegion[i] = ANCHOR_KEYS[best];
          cols[i * 3] = BASE.r; cols[i * 3 + 1] = BASE.g; cols[i * 3 + 2] = BASE.b;
        }
        colorAttr = new THREE.BufferAttribute(cols, 3);
        geo.setAttribute("color", colorAttr);
        bodyMesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.04 });
      }
      scene.add(model);
      const flag = document.getElementById("loaded");
      if (flag) flag.setAttribute("data-loaded", "true");
    });

    // click (not drag) → raycast → nearest region
    const raycaster = new THREE.Raycaster();
    let downX = 0, downY = 0, downT = 0;
    renderer.domElement.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; downT = Date.now(); });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (!bodyMesh) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || Date.now() - downT > 450) return; // was a drag
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(bodyMesh, true);
      if (!hits.length) return;
      const p = hits[0].point;
      let best = ANCHOR_KEYS[0], bestD = Infinity;
      for (const k of ANCHOR_KEYS) {
        const a = ANCHORS[k];
        const d = (p.x - a[0]) ** 2 + (p.y - a[1]) ** 2 + (p.z - a[2]) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      setSelected(best);
    });

    let raf = 0;
    const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
    tick();
    const onResize = () => { W = el.clientWidth; H = el.clientHeight || 600; camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); };
  }, []);

  const pointOf = (k: string) => report.find((p) => p.region === k);
  const setPain = (k: string, intensity: number, type?: PainType) => {
    const point = { region: k, intensity, type, timestamp: new Date().toISOString() };
    setReport([...report.filter((p) => p.region !== k), point]);
    apiRef.current?.recolor(k, heatColor(intensity));
  };
  const removePain = (k: string) => {
    setReport(report.filter((p) => p.region !== k));
    apiRef.current?.recolor(k, BASE);
    setSelected(null);
  };

  const region = selected ? REGIONS.find((r) => r.key === selected) : null;
  const current = selected ? pointOf(selected) : null;
  const btn: React.CSSProperties = { font: "inherit", cursor: "pointer", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", padding: "6px 9px" };

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#1e293b" }}>
      <h1 style={{ fontSize: 21, marginBottom: 6 }}>@broberg/bodymap — 3D (Blender Studio · CC0)</h1>
      <p style={{ color: "#64748b", marginBottom: 16, fontSize: 14 }}>
        <b>Træk</b> roter · <b>scroll</b> zoom · <b>klik en kropsdel</b> → sæt intensitet → kropsdelen farves efter smerten.
      </p>
      <span id="loaded" data-testid="bodymap3d-loaded" style={{ display: "none" }} />
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div ref={mountRef} data-testid="bodymap3d-canvas" style={{ flex: "1 1 520px", height: "72vh", minWidth: 320, borderRadius: 16, overflow: "hidden", background: "#0e1424" }} />
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
                  <button key={i} data-testid={`bodymap3d-intensity-${i}`} onClick={() => setPain(region.key, i, current?.type)}
                    style={{ ...btn, width: 30, height: 30, background: current?.intensity === i ? "#0e8f8a" : "#fff", color: current?.intensity === i ? "#fff" : "#1e293b" }}>{i}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 7 }}>Kvalitet</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {PAIN_TYPES.map((t) => (
                  <button key={t} data-testid={`bodymap3d-type-${t}`} onClick={() => setPain(region.key, current?.intensity ?? 5, t)}
                    style={{ ...btn, borderRadius: 999, padding: "6px 12px", background: current?.type === t ? "#1e293b" : "#fff", color: current?.type === t ? "#fff" : "#64748b" }}>{t}</button>
                ))}
              </div>
              {current && <button data-testid="bodymap3d-remove" onClick={() => removePain(region.key)} style={{ ...btn, color: "#ef4444", borderColor: "#f6c9c9" }}>Fjern punkt</button>}
            </div>
          ) : (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, background: "#fff", color: "#94a3b8", fontSize: 13.5 }}>Klik en kropsdel på figuren for at markere smerte.</div>
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

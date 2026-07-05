// Lens-verification demo for the PACKAGED 3D renderer (src/three → @broberg/bodymap/three).
// autoRotate=false so, with the new on-demand render loop, the page goes idle
// and a headless Lens run can land clicks. Models are served from ./ next to this file.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BodyMap3D } from "../src/three";
import { serializeReport, type PainReport } from "../src/index";

function App() {
  const [report, setReport] = useState<PainReport>([]);
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#1e293b" }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>@broberg/bodymap/three — packaged 3D</h1>
      <BodyMap3D
        models={{ male: "./body-male.glb", female: "./body-female.glb" }}
        onChange={setReport}
        autoRotate={false}
      />
      <pre
        data-testid="pkg3d-json"
        style={{ marginTop: 16, background: "#0f172a", color: "#cbd5e1", padding: 12, borderRadius: 8, fontSize: 12 }}
      >
        {JSON.stringify(serializeReport(report), null, 2)}
      </pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

// Lens-verification demo for the PACKAGED 3D renderer (src/three → @broberg/bodymap/three).
// autoRotate=false so, with the new on-demand render loop, the page goes idle
// and a headless Lens run can land clicks. Models are served from ./ next to this file.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BodyMap3D } from "../src/three";
import { serializeReport, type PainReport, type FeedbackSignal } from "../src/index";

function App() {
  const [report, setReport] = useState<PainReport>([]);
  // F052.22 — the feedback signal, rendered so a Lens run can read what the
  // renderer actually reported for each tap.
  const [feed, setFeed] = useState<string[]>([]);
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#1e293b" }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>@broberg/bodymap/three — packaged 3D</h1>
      <BodyMap3D
        models={{ male: "./body-male.glb", female: "./body-female.glb" }}
        onChange={setReport}
        onFeedback={(f: FeedbackSignal) => setFeed((prev) => [...prev, `${f.outcome}:${f.region}`])}
        autoRotate={false}
      />
      <pre data-testid="pkg3d-feedback" style={{ marginTop: 12, background: "#134e4a", color: "#ccfbf1", padding: 12, borderRadius: 8, fontSize: 12 }}>
        {feed.join(" | ") || "(ingen)"}
      </pre>
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

// F052.31–34 — one page that proves four cards in a real browser: fullscreen,
// the hint at stage-bottom, a region you can open, mark and clear, and the
// serialized bodymap/v1 report on screen so a flow can assert the RECORD.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BodyMap3D } from "../src/three";
import type { PainReport } from "../src/index";

function App() {
  const [report, setReport] = useState<PainReport>([]);
  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      <pre data-testid="demo-report" style={{ position: "fixed", left: 0, top: 0, zIndex: -1, margin: 0, fontSize: 10 }}>{JSON.stringify(report)}</pre>
      <BodyMap3D
        models={{ male: "./body-male.glb", female: "./body-female.glb" }}
        value={report}
        onChange={setReport}
        autoRotate={false}
        sex="female"
        showSexToggle={false}
        fullscreen
        hint={{ placement: "stage-bottom" }}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

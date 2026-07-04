// Standalone demo for Lens verification (not published). Mounts <BodyMap> and
// echoes the serialized bodymap/v1 report so a Lens flow can assert a click →
// a marked point in the structured output.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BodyMap } from "../src/react";
import { serializeReport, type PainReport } from "../src/index";

function App() {
  const [report, setReport] = useState<PainReport>([]);
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#1e293b" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>@broberg/bodymap — 2D demo</h1>
      <BodyMap onChange={setReport} />
      <pre
        data-testid="demo-json"
        style={{ marginTop: 20, background: "#0f172a", color: "#cbd5e1", padding: 14, borderRadius: 10, fontSize: 12 }}
      >
        {JSON.stringify(serializeReport(report), null, 2)}
      </pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

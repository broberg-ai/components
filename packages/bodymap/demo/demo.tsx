// Standalone demo for Lens verification (not published). Mounts <BodyMap> and
// echoes the serialized bodymap/v1 report so a Lens flow can assert a click →
// a marked point in the structured output. Query params drive the v0.1.3
// features for verification: ?locale=en · ?palette=ak · ?readonly.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BodyMap, BodyMapCompare } from "../src/react";
import { serializeReport, type BodymapPalette, type PainReport } from "../src/index";

const AK: BodymapPalette = {
  body: "#c8ccdd", hover: "#5CC4B7", selected: "#141969",
  heat: { low: "#FFE049", mid: "#F09A3E", high: "#D61C64" },
  regions: { chest: "#e6e9f2" },
};

function App() {
  const params = new URLSearchParams(window.location.search);
  const locale = params.get("locale") === "en" ? "en" : "da";
  const palette = params.get("palette") === "ak" ? AK : undefined;
  const readOnly = params.has("readonly");
  const seed: PainReport = readOnly
    ? [
        { region: "lumbar", intensity: 8, type: "dump", timestamp: "seed" },
        { region: "knee_right", intensity: 4, timestamp: "seed" },
      ]
    : [];

  const [report, setReport] = useState<PainReport>(seed);
  const [view, setView] = useState<"front" | "back">("front");

  if (params.has("compare")) {
    const before: PainReport = [
      { region: "lumbar", intensity: 8, type: "dump", timestamp: "b" },
      { region: "knee_right", intensity: 5, timestamp: "b" },
      { region: "shoulder_left", intensity: 4, timestamp: "b" },
    ];
    const after: PainReport = [
      { region: "lumbar", intensity: 3, timestamp: "a" }, // improved
      { region: "shoulder_left", intensity: 7, timestamp: "a" }, // worse
      { region: "neck", intensity: 5, timestamp: "a" }, // new
      // knee_right dropped → resolved
    ];
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#1e293b" }}>
        <h1 style={{ fontSize: 20, marginBottom: 16 }}>@broberg/bodymap — før/efter</h1>
        <BodyMapCompare before={before} after={after} locale={locale} palette={palette} />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#1e293b" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>@broberg/bodymap — 2D demo</h1>
      <BodyMap
        value={readOnly ? seed : undefined}
        defaultValue={readOnly ? undefined : seed}
        onChange={setReport}
        onViewChange={setView}
        locale={locale}
        palette={palette}
        readOnly={readOnly}
      />
      <pre
        data-testid="demo-json"
        style={{ marginTop: 20, background: "#0f172a", color: "#cbd5e1", padding: 14, borderRadius: 10, fontSize: 12 }}
      >
        {JSON.stringify(serializeReport(report, { view }), null, 2)}
      </pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

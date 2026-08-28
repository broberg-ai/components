// F052.23 repro — fd-sundhed's EXACT production props, so the framing + contrast
// report is reproduced rather than approximated.
import { createRoot } from "react-dom/client";
import { BodyMap3D } from "../src/three";
import { REGIONS, type PainReport, type RegionConfig } from "../src/index";

const locked: RegionConfig = Object.fromEntries(REGIONS.map((r) => [r.key, { selectable: false }]));
const palette = {
  body: "#c8ccdd",
  hover: "#9aa1c8",
  selected: "#141969",
  heat: { low: "#FFE049", mid: "#F09A3E", high: "#D61C64" },
};
const report: PainReport = [{ region: "knee_left", intensity: 9, timestamp: "2026-08-28T18:00:00.000Z" }];

function App() {
  return (
    <div style={{ padding: 12, fontFamily: "system-ui, sans-serif", color: "#1e293b" }}>
      <BodyMap3D
        models={{ male: "./body-male.glb", female: "./body-female.glb" }}
        value={report}
        config={locked}
        palette={palette}
        autoRotate={false}
        showSexToggle={false}
        sex="female"
        showRegionCode={false}
        canvasHeight="36vh"
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

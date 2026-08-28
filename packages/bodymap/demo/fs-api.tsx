// F052.24 AC#1 — the API path: NO built-in button, the consumer owns the state.
// This is literally what Christian asked for ("så API kan få komponentet ... i fullscreen").
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BodyMap3D } from "../src/three";

function App() {
  const [big, setBig] = useState(false);
  return (
    <div style={{ padding: 12, fontFamily: "system-ui, sans-serif" }}>
      <button data-testid="app-own-button" onClick={() => setBig(!big)}>
        {big ? "Luk" : "Se stor"}
      </button>
      <span data-testid="app-state">{big ? "big" : "small"}</span>
      <BodyMap3D
        models={{ male: "./body-male.glb", female: "./body-female.glb" }}
        fullscreen={big}
        onFullscreenChange={setBig}
        showFullscreenButton={false}
        autoRotate={false}
        showSexToggle={false}
        canvasHeight="36vh"
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

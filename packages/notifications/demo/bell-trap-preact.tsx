/** @jsxImportSource preact */
// F074.4 — the SAME fixture against the BUILT Preact entry (dist/preact.js).
// F074.4 — real-engine fixture for the focus trap (driven by Lens, never by
// happy-dom, which reports green on a trap that catches nothing).
// ?empty=1 renders the EMPTY panel, the most common screen.
// A focusable button sits BEHIND the panel as the negative control.
import { render } from "preact";
import { BellProvider, Bell, BellPanel, BellMarkAll, BellLayer, BellRow, useBellShell } from "../dist/preact.js";
import type { NotificationRow } from "../src/types";

const empty = new URLSearchParams(location.search).has("empty");
const row = (id: string): NotificationRow => ({ id, kind: "info", title: `Række ${id}`, body: null, navigate: null, refId: null, createdAt: 0, seenAt: null });
let count = empty ? 0 : 3;
const config = {
  labels: { bell: "Notifikationer", panel: "Notifikationer", markAll: "Markér alle læst", seeAll: "Se alle", empty: "Intet endnu", close: "Luk" },
  countUnseen: async () => count,
  markAllSeen: async () => { count = 0; return ["a", "b"]; },
  loadRows: async () => (empty ? [] : [row("a"), row("b")]),
};

function AlarmRow() {
  const { shell } = useBellShell();
  return (
    <button type="button" data-testid="alarm-row"
      onClick={(e) => shell.pushLayer({ id: "alarm", modal: true, focusReturn: e.currentTarget })}>Alarm</button>
  );
}
function Alarm() {
  const { shell } = useBellShell();
  return (
    <BellLayer id="alarm">
      <button type="button" data-testid="alarm-ack" onClick={() => shell.popLayer()}>Kvittér</button>
      <button type="button" data-testid="alarm-dismiss" onClick={() => shell.popLayer()}>Afvis</button>
    </BellLayer>
  );
}

function App() {
  return (
    <BellProvider config={config}>
      <header style={{ display: "flex", gap: 8, padding: 8 }}>
        <Bell />
        <button type="button" data-testid="behind">Bag panelet</button>
      </header>
      <BellPanel>
        <BellMarkAll />
        <BellRow id="a" onActivate={() => "stay"}>Række a</BellRow>
        <AlarmRow />
      </BellPanel>
      <Alarm />
      <output data-testid="active" />
    </BellProvider>
  );
}

// Expose which element has focus, so a manuscript can assert on it.
setInterval(() => {
  const a = document.activeElement as HTMLElement | null;
  const out = document.querySelector('[data-testid="active"]');
  if (out) out.textContent = a?.dataset?.testid ?? a?.tagName ?? "";
}, 50);

render(<App />, document.getElementById("root")!);

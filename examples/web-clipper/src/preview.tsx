// The popup served as a PAGE (server.ts, :5200), so Lens can see and drive it:
// Lens cannot load an extension. Same component and CSS as the real popup;
// auth, page and destination are in-memory fakes. Invented data.
// ?state=down makes every send fail with 503, ?state=consent asks for consent.
import "@broberg/theme/css/palettes.css";
import "@broberg/web-clipper/css/clipper.css";
import { render } from "preact";
import { initPalette, initTheme } from "@broberg/theme";
import { ClipperPopup } from "@broberg/web-clipper/ui";
import { DestinationError } from "@broberg/web-clipper/transport";
import { demoDestination } from "./demo";

initTheme();
initPalette();

const mode = new URLSearchParams(location.search).get("state");
const data = new Map<string, unknown>();
const storage = { get: async (k: string) => data.get(k), set: async (k: string, v: unknown) => void data.set(k, v), remove: async (k: string) => void data.delete(k) };
let session: { accessToken: string; sub: string; expiresAt: number } | null = null;
const auth = {
  async login() { await new Promise((r) => setTimeout(r, 400)); session = { accessToken: "demo", sub: "demo-user", expiresAt: Date.now() + 3600_000 }; return session; },
  async session() { return session; },
  async logout() { session = null; },
};
const base = demoDestination(storage);
const destination = {
  ...base,
  requiresConsent: mode === "consent",
  async send(...a: Parameters<typeof base.send>) {
    await new Promise((r) => setTimeout(r, 300));
    if (mode === "down") throw new DestinationError(503);
    return base.send(...a);
  },
};
const clip = mode === "consent"
  ? { url: "https://chatgpt.com/c/demo", title: "Samtale", anchor: "demo", units: [{ kind: "turn", role: "user", content: "Hej", position: 0 }] }
  : { url: "https://example.com/artikel", title: "En artikel", units: [{ kind: "page", content: "# En artikel", position: 0 }] };

render(
  <div style="padding:24px;display:flex;justify-content:center">
    <div style="border:1px solid var(--border);border-radius:var(--radius,8px);overflow:visible">
      <ClipperPopup title="Web Clipper Example" auth={auth} destination={destination} getClip={async () => clip} storage={storage} />
    </div>
  </div>,
  document.getElementById("app")!,
);

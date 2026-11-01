// The browser half: join, camera, screen share — and the state written as text Lens can assert.
import { joinVoice, type VoiceCall } from "../../packages/call/src/client.ts";

const q = new URLSearchParams(location.search);
const id = q.get("id") ?? "anon";
const room = q.get("room") ?? "default";
const n = Number(q.get("n") ?? "0");
const app = document.getElementById("app")!;
const url = (window as any).MEDIA_URL as string;

const el = (tag: string, attrs: Record<string, string> = {}, text = "") => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.textContent = text; return e; };
const status = el("div", { "data-testid": "call-status" }, "idle");
const media = el("div", { "data-testid": "call-local-media" }, "camera=false screen=false");
const videos = el("div", { "data-testid": "call-videos" }, "videos:");
const tiles = el("div", { "data-testid": "call-tiles" });
const errors = el("div", { "data-testid": "call-error" });

async function token(who: string) { const r = await fetch(`/token?id=${encodeURIComponent(who)}&room=${encodeURIComponent(room)}`); return (await r.json()).token as string; }

if (n > 0) {
  // Load test: n participants in this page, each with its camera on.
  app.append(el("h3", {}, `load: ${n} participants in components-test:${room}`), status, errors);
  (async () => {
    let joined = 0;
    for (let i = 0; i < n; i++) {
      try { const c = await joinVoice({ url, token: await token(`${id}-${i}`), publish: false }); await c.setCamera(true); joined++; status.textContent = `joined ${joined}/${n} with camera`; }
      catch (e) { errors.textContent += ` [${i}] ${(e as Error).message}`; }
    }
  })();
} else {
  let call: VoiceCall | undefined;
  const join = el("button", { "data-testid": "call-join" }, "Deltag");
  const cam = el("button", { "data-testid": "call-camera" }, "Kamera");
  const screen = el("button", { "data-testid": "call-screen" }, "Del skærm");
  const leave = el("button", { "data-testid": "call-leave" }, "Forlad");
  app.append(el("h3", {}, `${id} in components-test:${room}`), join, cam, screen, leave, status, media, videos, tiles, errors);
  join.onclick = async () => {
    try {
      status.textContent = "joining…";
      call = await joinVoice({ url, token: await token(id), publish: false });
      status.textContent = "joined";
      call.onLocalMedia((m) => (media.textContent = `camera=${m.camera} screen=${m.screenShare}`));
      call.onVideos((vs) => {
        videos.textContent = "videos:" + vs.map((v) => ` ${v.identity}:${v.source}${v.isLocal ? "(me)" : ""}`).join("");
        tiles.replaceChildren(...vs.map((v) => { const ve = document.createElement("video"); ve.setAttribute("data-testid", `call-tile-${v.identity}-${v.source}`); v.attach(ve); return ve; }));
      });
    } catch (e) { errors.textContent = (e as Error).message; status.textContent = "failed"; }
  };
  cam.onclick = async () => { try { await call?.setCamera(!call.localMedia.camera); } catch (e) { errors.textContent = (e as Error).message; } };
  screen.onclick = async () => { try { await call?.setScreenShare(!call.localMedia.screenShare); } catch (e) { errors.textContent = "screen: " + (e as Error).message; } };
  leave.onclick = async () => { await call?.leave(); status.textContent = "left"; };
}

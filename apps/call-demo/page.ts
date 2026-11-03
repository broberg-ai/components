// The browser half of call-demo: join, camera, screen share, record, play back.
import { joinVoice, type VoiceCall } from "../../packages/call/src/client.ts";

const app = document.getElementById("app")!;
const q = new URLSearchParams(location.search);
const h = (tag: string, attrs: Record<string, string> = {}, text = "") => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
};
const btn = (testid: string, label: string, cls = "") => h("button", { "data-testid": testid, class: cls, type: "button" }, label) as HTMLButtonElement;

const nameIn = h("input", { "data-testid": "demo-name", placeholder: "Dit navn", value: localStorage.getItem("demo-name") ?? "" }) as HTMLInputElement;
const roomIn = h("input", { "data-testid": "demo-room", placeholder: "Rum", value: q.get("room") ?? "demo" }) as HTMLInputElement;
const join = btn("demo-join", "Deltag", "primary");
const cam = btn("demo-camera", "Kamera");
const screen = btn("demo-screen", "Del skærm");
const recStart = btn("demo-record-start", "Optag");
const recStop = btn("demo-record-stop", "Stop optagelse");
const leave = btn("demo-leave", "Forlad");
const status = h("div", { class: "status", "data-testid": "demo-status" }, "Ikke forbundet");
const recBadge = h("span", { class: "rec", "data-testid": "demo-recording" });
recBadge.append(h("i"), document.createTextNode("Optager nu"));
const error = h("div", { class: "error", "data-testid": "demo-error" });
const tiles = h("div", { class: "tiles", "data-testid": "demo-tiles" });
const recList = h("ul", { "data-testid": "demo-recordings" });

app.append(
  h("h1", {}, "Call demo"),
  h("div", { class: "row" }), // filled below
  h("div", { class: "row" }),
  status, error, tiles,
  h("h2", { style: "font-size:16px;margin-top:20px" }, "Optagelser"), recList,
);
const [row1, row2] = app.querySelectorAll(".row");
row1.append(nameIn, roomIn, join);
row2.append(cam, screen, recStart, recStop, leave, recBadge);

let call: VoiceCall | undefined;
let recording: { id: string; room: string } | undefined;
const setConnected = (on: boolean) => {
  for (const b of [cam, screen, leave]) b.disabled = !on;
  recStart.disabled = !on || !!recording;
  join.disabled = on; nameIn.disabled = on; roomIn.disabled = on;
  recStop.disabled = !recording;
};
setConnected(false);

// Every button: busy while working, error shown, never a silent failure.
async function busy(b: HTMLButtonElement, label: string, fn: () => Promise<void>) {
  const old = b.textContent!;
  b.disabled = true; b.classList.add("busy"); b.textContent = label; error.textContent = "";
  try { await fn(); } catch (e) { error.textContent = (e as Error).message; }
  finally { b.classList.remove("busy"); b.textContent = old; b.disabled = false; setConnected(!!call); }
}
async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ? `Fejl: ${body.error}` : `Fejl ${r.status}`);
  return body;
}

join.onclick = () => busy(join, "Forbinder…", async () => {
  localStorage.setItem("demo-name", nameIn.value);
  const t = await api(`/token?name=${encodeURIComponent(nameIn.value)}&room=${encodeURIComponent(roomIn.value)}`);
  call = await joinVoice({ url: t.url, token: t.token });
  status.textContent = `Forbundet til rummet «${roomIn.value || "demo"}». Send linket ${location.origin}/?room=${encodeURIComponent(roomIn.value || "demo")} til den anden Mac.`;
  call.onLocalMedia((m) => { cam.classList.toggle("on", m.camera); screen.classList.toggle("on", m.screenShare); });
  call.onVideos((vs) => {
    tiles.replaceChildren(...vs.map((v) => {
      const t = h("div", { class: "tile", "data-testid": `demo-tile-${v.identity}-${v.source}` });
      const ve = document.createElement("video");
      v.attach(ve);
      t.append(ve, h("span", {}, `${v.name ?? v.identity}${v.isLocal ? " (dig)" : ""}${v.source === "screen_share" ? " · skærm" : ""}`));
      return t;
    }));
  });
});
cam.onclick = () => busy(cam, "…", async () => { await call!.setCamera(!call!.localMedia.camera); });
screen.onclick = () => busy(screen, "…", async () => { await call!.setScreenShare(!call!.localMedia.screenShare); });
leave.onclick = () => busy(leave, "Forlader…", async () => {
  await call?.leave(); call = undefined; tiles.replaceChildren(); status.textContent = "Ikke forbundet";
});

recStart.onclick = () => busy(recStart, "Starter… (op til 30 s)", async () => {
  const r = await api("/record/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ room: roomIn.value }) });
  recording = { id: r.recordingId, room: roomIn.value };
  recBadge.classList.add("show");
  status.textContent = "Optagelsen er startet. På en kold maskine går der ca. 20 sekunder, før billedet kommer med.";
});
recStop.onclick = () => busy(recStop, "Stopper…", async () => {
  if (!recording) return;
  const rec = recording;
  await api(`/record/${rec.id}/stop?room=${encodeURIComponent(rec.room)}`, { method: "POST" });
  recording = undefined; recBadge.classList.remove("show");
  const li = h("li", { "data-testid": `demo-recording-${rec.id}`, "data-pending": "" }, "Gemmer optagelsen…");
  recList.prepend(li);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await api(`/record/${rec.id}?room=${encodeURIComponent(rec.room)}`);
    const f = s.files?.[0];
    if (f?.name && f.size > 0) {
      li.remove();
      await loadRecordings();
      return;
    }
    // F104.9.7 — a recording can END with an error and no file ("stopped" + error, e.g.
    // «Start signal not received»). That used to fall through, so the line said
    // «Gemmer optagelsen…» for 3 minutes about a file that would never come.
    if (s.state === "failed" || ((s.state === "stopped" || s.state === "done") && s.error && !s.files?.length)) {
      li.textContent = `Optagelsen blev ikke gemt: ${s.error || "ukendt fejl"}`;
      li.className = "error";
      return;
    }
  }
  li.textContent = "Optagelsen blev ikke færdig inden for 3 minutter.";
});

// F104.9.7 — the list comes from the bucket, so it survives a reload and shows every
// recording made in the demo, newest first.
const fmtTime = (iso: string) => new Date(iso).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
async function loadRecordings() {
  const { recordings } = (await api("/recordings")) as { recordings: { key: string; size: number; at: string }[] };
  const pending = [...recList.querySelectorAll("li[data-pending]")];
  recList.replaceChildren(...pending);
  if (!recordings.length) { recList.append(h("li", { "data-testid": "demo-recordings-empty", class: "status" }, "Ingen optagelser endnu.")); return; }
  for (const r of recordings) {
    const li = h("li", { "data-testid": "demo-recording-item" });
    li.append(h("a", { href: `/play?key=${encodeURIComponent(r.key)}`, target: "_blank", rel: "noopener noreferrer", "data-testid": "demo-play" }, `Afspil — ${fmtTime(r.at)} (${(r.size / 1e6).toFixed(1)} MB)`));
    recList.append(li);
  }
}
loadRecordings().catch((e) => { error.textContent = `Kunne ikke hente optagelser: ${(e as Error).message}`; });

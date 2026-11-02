// F104.9.3 live: wait for 2 people in the room, ask CONTROL (not LiveKit) to record,
// wait for the recording to end, then report what control says.
import { RoomServiceClient } from "livekit-server-sdk";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
const [d, room] = [process.argv[2], process.argv[3]];
const t = s => readFileSync(d + "/" + s, "utf8").trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = x => Buffer.from(JSON.stringify(x)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const h = b({ alg: "HS256", typ: "JWT" }), p = b({ iss: t("lk.key"), nbf: now - 5, exp: now + 900, video: { roomRecord: true, room } });
const tok = `${h}.${p}.${createHmac("sha256", t("lk.sec")).update(`${h}.${p}`).digest("base64url")}`;
const C = "https://broberg-voice-control.fly.dev";
// This Mac's resolver keeps answering ENOTFOUND for this one new name while public DNS has it;
// pin the address (Fly's shared IPv4 for the app, `flyctl ips list`) for the TEST CLIENT only.
import { execFileSync } from "node:child_process";
const fetchR = async (u, o = {}) => {
  const args = ["-s", "--resolve", "broberg-voice-control.fly.dev:443:66.241.125.185", "-w", "\n%{http_code}", "-X", o.method ?? "GET"];
  for (const [k, v] of Object.entries(o.headers ?? {})) args.push("-H", `${k}: ${v}`);
  if (o.body) args.push("--data", o.body);
  const out = execFileSync("curl", [...args, u], { encoding: "utf8" });
  const i = out.lastIndexOf("\n");
  const body = out.slice(0, i), status = Number(out.slice(i + 1));
  return { status, json: async () => JSON.parse(body) };
};
const rs = new RoomServiceClient("https://voice.broberg.ai", t("lk.key"), t("lk.sec"));
for (let i = 0; i < 600; i++) { try { if ((await rs.listParticipants(room)).length >= 2) break; } catch {} await sleep(500); }
const t0 = Date.now();
const r = await fetchR(C + "/v1/recordings", { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify({ room }) });
const rec = await r.json();
console.log("start", r.status, JSON.stringify(rec), "in", Date.now() - t0, "ms");
for (let i = 0; i < 120 && rec.recordingId; i++) {
  await sleep(3000);
  const g = await (await fetchR(C + "/v1/recordings/" + rec.recordingId, { headers: { authorization: "Bearer " + tok } })).json();
  if (g.state !== "recording") { console.log("final", JSON.stringify(g)); break; }
}

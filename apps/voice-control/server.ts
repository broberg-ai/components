// F104.9.3 — broberg-voice-control. See control.ts for the decisions; this file
// is only the wiring: HTTP routes, LiveKit's Twirp API, Fly's Machines API.
import { createController, parseKeys, signJwt, verifyAppToken, type Deps, type EgressInfo } from "./control";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} must be set`);
  return v;
};
const APP_KEYS = parseKeys(env("LIVEKIT_KEYS")); // the apps that may ask for a recording
const EGRESS_KEY = env("LIVEKIT_EGRESS_API_KEY"); // control's own key towards LiveKit
const EGRESS_SECRET = env("LIVEKIT_EGRESS_API_SECRET");
const FLY_TOKEN = env("FLY_EGRESS_TOKEN"); // app-scoped to broberg-voice-egress only
const LIVEKIT_URL = process.env.LIVEKIT_INTERNAL_URL ?? "http://broberg-voice.internal:7880";
const EGRESS_APP = process.env.EGRESS_APP ?? "broberg-voice-egress";
const EGRESS_HEALTH = process.env.EGRESS_HEALTH_URL ?? `http://${EGRESS_APP}.internal:8080/`;
const MACHINES = `https://api.machines.dev/v1/apps/${EGRESS_APP}/machines`;
const flyAuth = FLY_TOKEN.startsWith("FlyV1 ") ? FLY_TOKEN : `Bearer ${FLY_TOKEN}`;

const log = (msg: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...data }));

async function twirp(service: string, method: string, body: unknown, video: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${LIVEKIT_URL}/twirp/livekit.${service}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${signJwt({ video }, EGRESS_KEY, EGRESS_SECRET, 60)}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`livekit ${method} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// Twirp answers in proto field names (snake_case); read both spellings so a
// server-side switch to camelCase cannot silently turn every field undefined.
const pick = (o: any, snake: string, camel: string) => o?.[snake] ?? o?.[camel];
const toInfo = (e: any): EgressInfo => ({
  id: pick(e, "egress_id", "egressId"),
  status: String(e?.status ?? ""),
  error: String(e?.error ?? ""),
  files: (pick(e, "file_results", "fileResults") ?? []).map((f: any) => ({
    name: String(f.filename ?? ""),
    size: Number(f.size ?? 0),
    durationSec: Number(f.duration ?? 0) / 1e9,
  })),
});

async function machine(): Promise<{ id: string; state: string }> {
  const res = await fetch(MACHINES, { headers: { authorization: flyAuth }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`fly list ${res.status}`);
  const list = (await res.json()) as { id: string; state: string }[];
  if (list.length !== 1) throw new Error(`expected exactly 1 recording machine, found ${list.length}`);
  return list[0];
}
async function machineAction(action: "start" | "stop") {
  const m = await machine();
  const res = await fetch(`${MACHINES}/${m.id}/${action}`, { method: "POST", headers: { authorization: flyAuth }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`fly ${action} ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const deps: Deps = {
  machine: {
    state: async () => (await machine()).state,
    start: () => machineAction("start"),
    stop: () => machineAction("stop"),
  },
  egressReady: async () => {
    try {
      return (await fetch(EGRESS_HEALTH, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
      return false;
    }
  },
  lk: {
    startComposite: async (room, filepath) =>
      toInfo(await twirp("Egress", "StartRoomCompositeEgress", { room_name: room, layout: "grid", file_outputs: [{ file_type: "MP4", filepath }] }, { roomRecord: true })).id,
    get: async (id) => {
      const r = await twirp("Egress", "ListEgress", { egress_id: id }, { roomRecord: true });
      const e = (r.items ?? [])[0];
      return e ? toInfo(e) : null;
    },
    activeCount: async () => ((await twirp("Egress", "ListEgress", { active: true }, { roomRecord: true })).items ?? []).length,
    stop: async (id) => { await twirp("Egress", "StopEgress", { egress_id: id }, { roomRecord: true }); },
    participants: async (room) => ((await twirp("RoomService", "ListParticipants", { room }, { roomAdmin: true, room })).participants ?? []).length,
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log,
};

const control = createController(deps);
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const view = (r: ReturnType<typeof control.recordings.get> & {}) => ({
  recordingId: r.id, egressId: r.egressId, room: r.room, state: r.state, attempts: r.attempts, error: r.error, files: r.files,
});

Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return json(200, { ok: true, recordings: [...control.recordings.values()].filter((r) => r.state === "recording").length });

    const auth = verifyAppToken(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? null, APP_KEYS);
    if (!auth.ok) return json(401, { error: auth.reason });

    try {
      if (req.method === "POST" && url.pathname === "/v1/recordings") {
        const body = (await req.json().catch(() => ({}))) as { room?: string };
        if (body.room !== auth.room) return json(403, { error: "room_not_in_token" });
        return json(200, view(await control.start(auth.room, auth.key)));
      }
      const m = url.pathname.match(/^\/v1\/recordings\/(rec_[\w-]+)(\/stop)?$/);
      if (m) {
        const rec = control.recordings.get(m[1]);
        if (!rec || rec.room !== auth.room) return json(404, { error: "not_found" });
        if (req.method === "POST" && m[2]) return json(200, view((await control.stop(rec.id))!));
        if (req.method === "GET" && !m[2]) return json(200, view(rec));
      }
      return json(404, { error: "not_found" });
    } catch (e) {
      log("request failed", { path: url.pathname, error: String(e) });
      return json(e instanceof Error && e.message === "invalid_room" ? 400 : 502, { error: e instanceof Error ? e.message : "failed" });
    }
  },
});

let ticking = false;
setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try { await control.tick(); } catch (e) { log("tick failed", { error: String(e) }); } finally { ticking = false; }
}, 3000);
setInterval(() => control.idleCheck().catch((e) => log("idle check failed", { error: String(e) })), 60_000);
log("broberg-voice-control ready", { apps: [...APP_KEYS.keys()], egressApp: EGRESS_APP });

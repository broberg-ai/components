// F104.9.3 — broberg-voice-control: starts the recording machine on demand,
// starts the recording, retries a recording that never got its start signal,
// and stops the machine again when nothing is being recorded.
// Zero dependencies: HS256 JWTs, LiveKit's Twirp JSON API and Fly's Machines
// API are all plain fetch. Everything that touches the network is injected, so
// the decisions in this file are tested without one.
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

// ---------- JWT (HS256), the same tokens LiveKit itself uses ----------

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signJwt(claims: Record<string, unknown>, key: string, secret: string, ttlSec = 600): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: key, nbf: now - 5, exp: now + ttlSec, ...claims }));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export type AppAuth = { ok: true; key: string; room: string } | { ok: false; reason: string };

/** An app proves itself with a JWT signed by ITS OWN LiveKit key, carrying
 *  video.roomRecord and the room it may record — the same grant LiveKit
 *  requires to record directly. */
export function verifyAppToken(token: string | null, keys: Map<string, string>, nowSec = Math.floor(Date.now() / 1000)): AppAuth {
  if (!token) return { ok: false, reason: "missing_token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed_token" };
  const [h64, p64, sig64] = parts as [string, string, string];
  let head: any, body: any;
  try {
    head = JSON.parse(Buffer.from(h64, "base64url").toString());
    body = JSON.parse(Buffer.from(p64, "base64url").toString());
  } catch {
    return { ok: false, reason: "malformed_token" };
  }
  if (head?.alg !== "HS256") return { ok: false, reason: "bad_alg" };
  const secret = typeof body?.iss === "string" ? keys.get(body.iss) : undefined;
  if (!secret) return { ok: false, reason: "unknown_key" };
  const want = createHmac("sha256", secret).update(`${h64}.${p64}`).digest();
  const got = Buffer.from(sig64, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "bad_signature" };
  if (typeof body.exp !== "number" || body.exp < nowSec) return { ok: false, reason: "expired" };
  if (typeof body.nbf === "number" && body.nbf > nowSec + 5) return { ok: false, reason: "not_yet_valid" };
  if (body.video?.roomRecord !== true) return { ok: false, reason: "missing_grant" };
  if (typeof body.video?.room !== "string" || !ROOM_RE.test(body.video.room)) return { ok: false, reason: "missing_room" };
  return { ok: true, key: body.iss, room: body.video.room };
}

/** LIVEKIT_KEYS is LiveKit's own format: one "key: secret" per line. */
export function parseKeys(raw: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const i = line.indexOf(": ");
    if (i > 0) m.set(line.slice(0, i).trim(), line.slice(i + 2).trim());
  }
  return m;
}

export const ROOM_RE = /^[\w:.-]{1,128}$/;

// ---------- the recording controller ----------

export type EgressInfo = { id: string; status: string; error: string; files: { name: string; size: number; durationSec: number }[] };

export type Deps = {
  machine: { state(): Promise<string>; start(): Promise<void>; stop(): Promise<void> };
  egressReady(): Promise<boolean>; // the recording machine answers its health port
  lk: {
    startComposite(room: string, filepath: string, layout: EgressLayout): Promise<string>; // → egress id
    /** F104.9.8 — a recording of a BLANK web page, never of a meeting: it only makes the
     *  recording machine launch its browser once, so the first real recording starts warm. */
    startWarmup(filepath: string): Promise<string>;
    get(egressId: string): Promise<EgressInfo | null>;
    activeCount(): Promise<number>;
    stop(egressId: string): Promise<void>;
    participants(room: string): Promise<number>;
  };
  now(): number;
  sleep(ms: number): Promise<void>;
  log(msg: string, data?: Record<string, unknown>): void;
};

/**
 * F104.9.9 — what the recording looks like. Owner 3/11: like Google Meet by default —
 * only the person speaking fills the picture — and "grid" for everyone at once.
 * Our value → LiveKit's room-composite layout.
 */
export const LAYOUTS = { speaker: "single-speaker", grid: "grid" } as const;
export type Layout = keyof typeof LAYOUTS;
export type EgressLayout = (typeof LAYOUTS)[Layout];
export const isLayout = (v: unknown): v is Layout => typeof v === "string" && Object.hasOwn(LAYOUTS, v);

export type Recording = {
  id: string; room: string; owner: string; egressId: string; attempts: number;
  layout: Layout;
  state: "recording" | "complete" | "failed" | "stopped"; error?: string;
  files?: EgressInfo["files"];
  /** F104.9.7 — true once the egress reports EGRESS_ACTIVE: the recorder has really
   *  started. Before that a cold machine is still launching its browser (~20 s), and a
   *  stop then ends with «Start signal not received» and no file. */
  live?: boolean;
  /** F104.9.10 — control's clock when «Optag» arrived and when «Stop» arrived. */
  requestedAt?: number;
  stoppedAt?: number;
};

const FINAL = new Set(["EGRESS_COMPLETE", "EGRESS_FAILED", "EGRESS_ABORTED", "EGRESS_LIMIT_REACHED"]);
// Measured 2/11 2026: 1 of 3 recordings never got its subscriptions and ended
// «Start signal not received» while everyone was still in the room.
const RETRYABLE = /start signal not received/i;
export const MAX_ATTEMPTS = 3;
export const READY_TIMEOUT_MS = 90_000;
// The machine is stopped once nothing has been recorded for this long, so a
// second recording right after the first does not pay another cold start.
// Owner 3/11 2026: start cold, warm up when a meeting starts, and if nothing is recorded
// within 3 minutes, turn it off again — so a meeting without a recording costs 3 minutes.
export const IDLE_GRACE_MS = 3 * 60_000;
/**
 * F104.9.8 — an egress still «starting» after this long is an orphan, not a recording: a
 * real start reaches ACTIVE in under a minute. Measured 3/11 2026: an egress whose machine
 * went away stayed EGRESS_STARTING in LiveKit for hours, could not be stopped, and kept the
 * recording machine on because idleCheck counted it as active.
 */
export const STALE_STARTING_MS = 2 * 60_000;

/** How many egresses really hold the recording machine: active ones, plus starting ones that are still young. */
export function countActive(items: { status?: unknown; started_at?: unknown; startedAt?: unknown }[], nowMs: number): number {
  return items.filter((e) => {
    const status = String(e.status ?? "");
    if (status === "EGRESS_ACTIVE" || status === "EGRESS_ENDING") return true;
    if (status !== "EGRESS_STARTING") return false;
    const ns = Number(e.started_at ?? e.startedAt ?? 0); // LiveKit reports nanoseconds since epoch
    return ns > 0 && nowMs - ns / 1e6 < STALE_STARTING_MS;
  }).length;
}
export const WARMUP_WAIT_MS = 60_000;

export function createController(d: Deps) {
  const recordings = new Map<string, Recording>();
  let lastUse = 0;
  // F104.9.8 — has the browser on the recording machine run since it last started?
  let warm: "cold" | "warming" | "warm" = "cold";

  async function ensureMachine() {
    lastUse = d.now();
    if ((await d.machine.state()) !== "started") {
      d.log("starting the recording machine");
      await d.machine.start();
    }
    const until = d.now() + READY_TIMEOUT_MS;
    while (!(await d.egressReady())) {
      if (d.now() > until) throw new Error("recording machine did not become ready");
      await d.sleep(1000);
    }
  }

  async function withRetry(fn: () => Promise<string>): Promise<string> {
    let last: unknown;
    for (let i = 0; i < 10; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        await d.sleep(2000);
      }
    }
    throw last;
  }

  async function warmUp() {
    const t0 = d.now();
    try {
      await ensureMachine();
      const id = await withRetry(() => d.lk.startWarmup(`warmup/{time}.mp4`));
      const until = d.now() + WARMUP_WAIT_MS;
      let e = await d.lk.get(id);
      while (e && e.status !== "EGRESS_ACTIVE" && !FINAL.has(e.status) && d.now() < until) {
        await d.sleep(1000);
        e = await d.lk.get(id);
      }
      await d.lk.stop(id).catch(() => {}); // already ended is fine
      warm = "warm";
      lastUse = d.now();
      d.log("recording machine warmed up", { ms: d.now() - t0, status: e?.status ?? "unknown" });
    } catch (err) {
      warm = "cold";
      d.log("warm-up failed", { error: String(err) });
    }
  }

  async function startEgress(room: string, layout: Layout): Promise<string> {
    // LiveKit answers «no response from servers» for the few seconds before a
    // fresh egress node has registered itself, so the first call may need a retry.
    return withRetry(() => d.lk.startComposite(room, `${room}/{time}.mp4`, LAYOUTS[layout]));
  }

  return {
    recordings,
    get warmth() { return warm; },

    /**
     * F104.9.8 — a meeting started: get the recording machine and its browser ready so a
     * recording started soon after begins in seconds. Returns at once; the warm-up runs on.
     * Nothing is recorded — the warm-up films a blank page. If no recording follows within
     * IDLE_GRACE_MS, idleCheck turns the machine off again.
     */
    prewarm(): { warmth: "cold" | "warming" | "warm" } {
      lastUse = d.now();
      d.log("prewarm requested", { warmth: warm });
      if (warm === "cold") {
        warm = "warming";
        void warmUp();
      }
      return { warmth: warm };
    },
    async start(room: string, owner: string, layout: Layout = "speaker"): Promise<Recording> {
      if (!ROOM_RE.test(room)) throw new Error("invalid_room");
      if (!isLayout(layout)) throw new Error("invalid_layout");
      for (const r of recordings.values()) if (r.room === room && r.state === "recording") return r;
      const requestedAt = d.now();
      const warmth = warm; // F104.9.10 — was the machine ready when «Optag» was pressed?
      await ensureMachine();
      const egressId = await startEgress(room, layout);
      if (warm === "cold") warm = "warm"; // a real recording launches the browser too
      const rec: Recording = { id: "rec_" + randomBytes(9).toString("base64url"), room, owner, egressId, attempts: 1, layout, state: "recording", requestedAt };
      recordings.set(rec.id, rec);
      d.log("recording started", { id: rec.id, room, egressId, layout, warmth, acceptedMs: d.now() - requestedAt });
      return rec;
    },

    async stop(id: string): Promise<Recording | null> {
      const rec = recordings.get(id);
      if (!rec) return null;
      if (rec.state === "recording") {
        await d.lk.stop(rec.egressId).catch(() => {}); // already ended is fine: tick() reads the result
        rec.state = "stopped";
        rec.stoppedAt = d.now();
      }
      lastUse = d.now();
      return rec;
    },

    /** Every few seconds: follow running recordings, retry one that never started. */
    async tick() {
      for (const rec of recordings.values()) {
        if (rec.state !== "recording" && !(rec.state === "stopped" && !rec.files)) continue;
        const e = await d.lk.get(rec.egressId);
        if (e && rec.state === "recording" && e.status === "EGRESS_ACTIVE" && !rec.live) {
          rec.live = true;
          d.log("recording live", { id: rec.id, startToLiveMs: d.now() - (rec.requestedAt ?? d.now()), attempts: rec.attempts });
        }
        if (!e || !FINAL.has(e.status)) continue;
        lastUse = d.now();
        if (rec.state === "recording" && RETRYABLE.test(e.error) && rec.attempts < MAX_ATTEMPTS && (await d.lk.participants(rec.room)) > 0) {
          rec.attempts++;
          d.log("recording got no start signal, starting it again", { id: rec.id, attempt: rec.attempts });
          rec.egressId = await startEgress(rec.room, rec.layout);
          rec.live = false;
          continue;
        }
        rec.files = e.files;
        if (rec.state === "recording") {
          rec.state = e.status === "EGRESS_COMPLETE" ? "complete" : "failed";
          if (rec.state === "failed") rec.error = e.error;
        } else if (!e.files.length && e.error) {
          // F104.9.7 — stopped by the user, but nothing was written (stopped before the
          // recorder started). Say why, or the caller waits for a file that never comes.
          rec.error = e.error;
        }
        // F104.9.10 — how long the file took after «Stop» (or why there is none).
        const sinceStop = d.now() - (rec.stoppedAt ?? d.now());
        if (e.files.length) {
          const f = e.files[0]!;
          d.log("recording saved", { id: rec.id, state: rec.state, stopToFileMs: sinceStop, bytes: f.size, durationSec: Math.round(f.durationSec) });
        } else {
          d.log("recording not saved", { id: rec.id, state: rec.state, error: e.error, stopToEndMs: sinceStop });
        }
      }
    },

    /** Every minute: stop the machine when nothing is recorded and the grace period has passed. */
    async idleCheck(): Promise<boolean> {
      if (d.now() - lastUse < IDLE_GRACE_MS) return false;
      if ((await d.lk.activeCount()) > 0) { lastUse = d.now(); return false; }
      if ((await d.machine.state()) !== "started") return false;
      d.log("nothing is being recorded, stopping the recording machine");
      await d.machine.stop();
      warm = "cold";
      return true;
    },
  };
}

import { describe, expect, test } from "bun:test";
import { createController, signJwt, verifyAppToken, parseKeys, IDLE_GRACE_MS, MAX_ATTEMPTS, type Deps, type EgressInfo } from "./control";

const KEYS = parseKeys("APIjam: jamsecret\nAPIother: othersecret");
const tok = (claims: Record<string, unknown>, key = "APIjam", secret = "jamsecret") => signJwt(claims, key, secret);
const grant = (room = "jam:room1") => ({ video: { roomRecord: true, room } });

describe("verifyAppToken", () => {
  test("a token signed with the app's own key, with roomRecord and a room, is accepted", () => {
    expect(verifyAppToken(tok(grant()), KEYS)).toEqual({ ok: true, key: "APIjam", room: "jam:room1" });
  });
  test("a wrong signature is refused", () => {
    expect(verifyAppToken(tok(grant(), "APIjam", "notthesecret"), KEYS)).toEqual({ ok: false, reason: "bad_signature" });
  });
  test("a key this server does not know is refused", () => {
    expect(verifyAppToken(tok(grant(), "APIstranger", "x"), KEYS)).toEqual({ ok: false, reason: "unknown_key" });
  });
  test("an expired token is refused", () => {
    const t = signJwt(grant(), "APIjam", "jamsecret", -60);
    expect(verifyAppToken(t, KEYS)).toEqual({ ok: false, reason: "expired" });
  });
  test("a token without the record grant is refused", () => {
    expect(verifyAppToken(tok({ video: { roomJoin: true, room: "jam:room1" } }), KEYS)).toEqual({ ok: false, reason: "missing_grant" });
  });
  test("no token, or garbage, is refused", () => {
    expect(verifyAppToken(null, KEYS).ok).toBe(false);
    expect(verifyAppToken("a.b", KEYS).ok).toBe(false);
    expect(verifyAppToken("x.y.z", KEYS).ok).toBe(false);
  });
  test("alg none is refused even with a known iss", () => {
    const h = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const b = Buffer.from(JSON.stringify({ iss: "APIjam", exp: 9e9, ...grant() })).toString("base64url");
    expect(verifyAppToken(`${h}.${b}.`, KEYS)).toEqual({ ok: false, reason: "bad_alg" });
  });
});

function fake(opts: { participants?: number } = {}) {
  let t = 0;
  let state = "stopped";
  const calls: string[] = [];
  let started = 0;
  const egress = new Map<string, EgressInfo>();
  const d: Deps = {
    machine: {
      state: async () => state,
      start: async () => { calls.push("machine.start"); state = "started"; },
      stop: async () => { calls.push("machine.stop"); state = "stopped"; },
    },
    egressReady: async () => state === "started",
    lk: {
      startComposite: async (room, filepath) => {
        const id = `EG_${++started}`;
        calls.push(`start ${room} ${filepath}`);
        egress.set(id, { id, status: "EGRESS_ACTIVE", error: "", files: [] });
        return id;
      },
      startWarmup: async (filepath) => {
        const id = `EG_${++started}`;
        calls.push(`warmup ${filepath}`);
        egress.set(id, { id, status: "EGRESS_ACTIVE", error: "", files: [] });
        return id;
      },
      get: async (id) => egress.get(id) ?? null,
      activeCount: async () => [...egress.values()].filter((e) => e.status === "EGRESS_ACTIVE").length,
      stop: async (id) => { calls.push(`stop ${id}`); const e = egress.get(id)!; e.status = "EGRESS_COMPLETE"; e.files = [{ name: "x.mp4", size: 10, durationSec: 5 }]; },
      participants: async () => opts.participants ?? 2,
    },
    now: () => t,
    sleep: async (ms) => { t += ms; },
    log: () => {},
  };
  return { d, calls, egress, advance: (ms: number) => { t += ms; }, setState: (s: string) => { state = s; } };
}

describe("controller", () => {
  test("start turns the machine on, starts a room recording and returns its ids", async () => {
    const f = fake();
    const c = createController(f.d);
    const rec = await c.start("jam:room1", "APIjam");
    expect(f.calls).toEqual(["machine.start", "start jam:room1 jam:room1/{time}.mp4"]);
    expect(rec.egressId).toBe("EG_1");
    expect(rec.id).toMatch(/^rec_/);
    expect(rec.state).toBe("recording");
  });

  test("a second start for the same room returns the running recording, not a second one", async () => {
    const f = fake();
    const c = createController(f.d);
    const a = await c.start("jam:room1", "APIjam");
    const b = await c.start("jam:room1", "APIjam");
    expect(b.id).toBe(a.id);
    expect(f.calls.filter((x) => x.startsWith("start ")).length).toBe(1);
  });

  test("a recording that ends «Start signal not received» while people are in the room is started again", async () => {
    const f = fake();
    const c = createController(f.d);
    const rec = await c.start("jam:room1", "APIjam");
    f.egress.get("EG_1")!.status = "EGRESS_ABORTED";
    f.egress.get("EG_1")!.error = "Start signal not received";
    await c.tick();
    expect(rec.egressId).toBe("EG_2");
    expect(rec.attempts).toBe(2);
    expect(rec.state).toBe("recording");
  });

  test("it gives up after MAX_ATTEMPTS and reports the failure", async () => {
    const f = fake();
    const c = createController(f.d);
    const rec = await c.start("jam:room1", "APIjam");
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const e = f.egress.get(rec.egressId)!;
      e.status = "EGRESS_ABORTED";
      e.error = "Start signal not received";
      await c.tick();
    }
    expect(rec.attempts).toBe(MAX_ATTEMPTS);
    expect(rec.state).toBe("failed");
    expect(rec.error).toMatch(/start signal/i);
  });

  test("no retry when the room is empty", async () => {
    const f = fake({ participants: 0 });
    const c = createController(f.d);
    const rec = await c.start("jam:room1", "APIjam");
    f.egress.get("EG_1")!.status = "EGRESS_ABORTED";
    f.egress.get("EG_1")!.error = "Start signal not received";
    await c.tick();
    expect(rec.attempts).toBe(1);
    expect(rec.state).toBe("failed");
  });

  test("stop ends the recording and the next tick reads the file", async () => {
    const f = fake();
    const c = createController(f.d);
    const rec = await c.start("jam:room1", "APIjam");
    await c.stop(rec.id);
    await c.tick();
    expect(rec.state).toBe("stopped");
    expect(rec.files).toEqual([{ name: "x.mp4", size: 10, durationSec: 5 }]);
  });

  test("the machine is stopped only when nothing records AND the grace period has passed", async () => {
    const f = fake();
    const c = createController(f.d);
    const rec = await c.start("jam:room1", "APIjam");
    f.advance(IDLE_GRACE_MS + 1);
    expect(await c.idleCheck()).toBe(false); // still recording
    await c.stop(rec.id);
    await c.tick();
    expect(await c.idleCheck()).toBe(false); // within grace after the stop
    f.advance(IDLE_GRACE_MS + 1);
    expect(await c.idleCheck()).toBe(true);
    expect(f.calls.at(-1)).toBe("machine.stop");
  });

  test("an invalid room name is refused before anything is started", async () => {
    const f = fake();
    const c = createController(f.d);
    await expect(c.start("../etc", "APIjam")).rejects.toThrow("invalid_room");
    expect(f.calls).toEqual([]);
  });

  // F104.9.7 — the owner pressed Stop ~18 s in, before the cold recorder had started:
  // egress ended «Start signal not received», no file, and the page waited 3 minutes.
  test("live is false while the egress is still starting, true once it reports EGRESS_ACTIVE", async () => {
    const f = fake();
    const c = createController(f.d);
    const rec = await c.start("jam:live1", "APIjam");
    f.egress.get(rec.egressId)!.status = "EGRESS_STARTING";
    await c.tick();
    expect(rec.live).toBeFalsy();
    f.egress.get(rec.egressId)!.status = "EGRESS_ACTIVE";
    await c.tick();
    expect(rec.live).toBe(true);
  });

  test("a recording stopped before it started reports WHY, with no file", async () => {
    const f = fake();
    const c = createController(f.d);
    const rec = await c.start("jam:early1", "APIjam");
    f.egress.get(rec.egressId)!.status = "EGRESS_STARTING";
    f.d.lk.stop = async (id) => { const e = f.egress.get(id)!; e.status = "EGRESS_ABORTED"; e.error = "Start signal not received"; e.files = []; };
    await c.stop(rec.id);
    await c.tick();
    expect(rec.state).toBe("stopped");
    expect(rec.error).toBe("Start signal not received");
    expect(rec.files).toEqual([]);
  });

  test("a normal stop keeps no error and carries the file", async () => {
    const f = fake();
    const c = createController(f.d);
    const rec = await c.start("jam:ok1", "APIjam");
    await c.stop(rec.id);
    await c.tick();
    expect(rec.error).toBeUndefined();
    expect(rec.files?.[0]?.name).toBe("x.mp4");
  });

  // F104.9.8 — owner 3/11: start cold; warm up when a meeting starts; off again after 3 min.
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

  test("prewarm starts the machine and films a BLANK page, never the meeting, then stops it", async () => {
    const f = fake();
    const c = createController(f.d);
    expect(c.prewarm()).toEqual({ warmth: "warming" });
    await settle();
    expect(f.calls).toEqual(["machine.start", "warmup warmup/{time}.mp4", "stop EG_1"]);
    expect(f.calls.some((x) => x.startsWith("start "))).toBe(false); // no room was recorded
    expect(c.warmth).toBe("warm");
  });

  test("a second prewarm while warm or warming starts nothing new", async () => {
    const f = fake();
    const c = createController(f.d);
    c.prewarm();
    expect(c.prewarm()).toEqual({ warmth: "warming" });
    await settle();
    expect(c.prewarm()).toEqual({ warmth: "warm" });
    expect(f.calls.filter((x) => x.startsWith("warmup"))).toHaveLength(1);
  });

  test("no recording within 3 minutes of a prewarm: the machine goes off and is cold again", async () => {
    expect(IDLE_GRACE_MS).toBe(3 * 60_000);
    const f = fake();
    const c = createController(f.d);
    c.prewarm();
    await settle();
    f.advance(IDLE_GRACE_MS - 1000);
    expect(await c.idleCheck()).toBe(false);
    f.advance(2000);
    expect(await c.idleCheck()).toBe(true);
    expect(f.calls.at(-1)).toBe("machine.stop");
    expect(c.warmth).toBe("cold");
  });

  test("a failed warm-up leaves the machine cold (the next prewarm tries again)", async () => {
    const f = fake();
    f.d.lk.startWarmup = async () => { throw new Error("boom"); };
    f.d.sleep = async () => {};
    const c = createController(f.d);
    c.prewarm();
    await settle(); await settle(); await settle();
    for (let i = 0; i < 30 && c.warmth !== "cold"; i++) await settle();
    expect(c.warmth).toBe("cold");
  });
});

// F103.1 — the server half, read the way a browser reads it: bytes off the Response body.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRealtime, lastEventIdFrom, memoryBus, postgresBus, RealtimeError, type RealtimeEvent } from "../src/server";

type Frame = { id?: string; data?: { type: string; data?: unknown }; retry?: string; raw: string };

/** Read SSE frames off a Response until `until(frames)` is true or the time runs out. */
async function readFrames(res: Response, until: (f: Frame[]) => boolean, ms = 2000): Promise<Frame[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const frames: Frame[] = [];
  let buf = "";
  const deadline = Date.now() + ms;
  while (!until(frames) && Date.now() < deadline) {
    const r = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((ok) => setTimeout(() => ok({ done: true, value: undefined }), 50))]);
    if (r.value) buf += dec.decode(r.value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const f: Frame = { raw };
      for (const line of raw.split("\n")) {
        if (line.startsWith("id: ")) f.id = line.slice(4);
        else if (line.startsWith("data: ")) f.data = JSON.parse(line.slice(6));
        else if (line.startsWith("retry: ")) f.retry = line.slice(7);
      }
      frames.push(f);
    }
    if (r.done && !r.value) continue;
  }
  reader.cancel().catch(() => {});
  return frames;
}
const events = (fs: Frame[]) => fs.filter((f) => f.data && f.data.type !== "$ping");
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

describe("stream: headers, heartbeat, cleanup", () => {
  it("text/event-stream, no-cache, x-accel-buffering no, a retry line first", async () => {
    const rt = createRealtime();
    const res = rt.stream("c1");
    expect([res.headers.get("content-type"), res.headers.get("cache-control"), res.headers.get("x-accel-buffering")]).toStrictEqual([
      "text/event-stream; charset=utf-8",
      "no-cache, no-transform",
      "no",
    ]);
    const fs = await readFrames(res, (f) => f.length >= 1);
    expect(fs[0]!.retry).toBe("1000");
  });

  it("a visible $ping every heartbeatMs", async () => {
    vi.useFakeTimers();
    const rt = createRealtime({ heartbeatMs: 15_000 });
    const reader = rt.stream("c1").body!.getReader();
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    vi.useRealTimers();
    let text = "";
    for (let i = 0; i < 3; i++) text += new TextDecoder().decode((await reader.read()).value);
    expect(text.match(/"type":"\$ping"/g)?.length).toBe(2);
  });

  it("an aborted stream leaves no listener behind", () => {
    const rt = createRealtime();
    const ac = new AbortController();
    rt.stream("c1", { signal: ac.signal });
    rt.stream("c1");
    expect(rt.listenerCount("c1")).toBe(2);
    ac.abort();
    expect(rt.listenerCount("c1")).toBe(1);
  });
});

describe("resume: missed events first, then live — none lost, none twice", () => {
  it("an event published WHILE the replay runs comes AFTER the replayed ones", async () => {
    let releaseReplay!: () => void;
    const gate = new Promise<void>((r) => (releaseReplay = r));
    const rt = createRealtime({
      replay: async () => {
        await gate;
        return [{ type: "message", data: { n: 2 }, id: "2" }, { type: "message", data: { n: 3 }, id: "3" }];
      },
    });
    const reading = readFrames(rt.stream("room", { lastEventId: "1" }), (f) => events(f).length >= 3);
    await flush();
    await rt.publish("room", { type: "message", data: { n: 4 }, id: "4" });
    releaseReplay();
    expect(events(await reading).map((f) => f.id)).toStrictEqual(["2", "3", "4"]);
  });

  it("an event that is BOTH replayed and published during the replay arrives exactly once", async () => {
    let releaseReplay!: () => void;
    const gate = new Promise<void>((r) => (releaseReplay = r));
    const rt = createRealtime({
      replay: async (_c, since) => {
        expect(since).toBe("1");
        await gate;
        return [{ type: "message", data: { n: 2 }, id: "2" }, { type: "message", data: { n: 3 }, id: "3" }];
      },
    });
    const reading = readFrames(rt.stream("room", { lastEventId: "1" }), () => false, 300);
    await flush();
    await rt.publish("room", { type: "message", data: { n: 3 }, id: "3" });
    releaseReplay();
    expect(events(await reading).map((f) => f.id)).toStrictEqual(["2", "3"]);
  });

  it("lastEventIdFrom reads the header first, then ?lastEventId=", () => {
    expect(lastEventIdFrom(new Request("https://x/s?lastEventId=q", { headers: { "last-event-id": "h" } }))).toBe("h");
    expect(lastEventIdFrom(new Request("https://x/s?lastEventId=q"))).toBe("q");
    expect(lastEventIdFrom(new Request("https://x/s"))).toBe(null);
  });
});

describe("durable vs ephemeral", () => {
  it("a durable event carries an id line; an ephemeral one does not", async () => {
    const rt = createRealtime();
    const res = rt.stream("room");
    const reading = readFrames(res, (f) => events(f).length >= 2);
    await flush();
    await rt.publish("room", { type: "message", data: { t: "hej" }, id: "m1" });
    await rt.publish("room", { type: "typing", data: { who: "a" } });
    const fs = events(await reading);
    expect(fs.map((f) => [f.id ?? null, f.data!.type])).toStrictEqual([["m1", "message"], [null, "typing"]]);
    expect(fs[1]!.raw.includes("id:")).toBe(false);
  });

  it("refuses a $-type (the package's own) and a type or id with a newline (frame injection)", async () => {
    const rt = createRealtime();
    for (const e of [{ type: "$ping" }, { type: "a\ndata: x" }, { type: "ok", id: "1\nid: 2" }] as RealtimeEvent[]) {
      await expect(rt.publish("room", e)).rejects.toBeInstanceOf(RealtimeError);
    }
  });
});

function fakeSql() {
  const listeners = new Map<string, Array<(p: string) => void>>();
  const notified: string[] = [];
  const sql = {
    async listen(ch: string, fn: (p: string) => void) {
      listeners.set(ch, [...(listeners.get(ch) ?? []), fn]);
    },
    async notify(ch: string, payload: string) {
      notified.push(payload);
      for (const fn of listeners.get(ch) ?? []) fn(payload);
    },
  };
  return { sql, notified };
}

describe("several machines: postgresBus", () => {
  it("a publish on hub A reaches a stream on hub B, and A's own stream gets it exactly once", async () => {
    const { sql } = fakeSql();
    const a = createRealtime({ bus: postgresBus(sql) });
    const b = createRealtime({ bus: postgresBus(sql) });
    // Read for a fixed window, not «until one arrived» — a duplicate comes AFTER the first.
    const onA = readFrames(a.stream("room"), () => false, 300);
    const onB = readFrames(b.stream("room"), (f) => events(f).length >= 1, 400);
    await flush();
    await a.publish("room", { type: "message", data: { n: 1 }, id: "1" });
    expect(events(await onB).map((f) => f.id)).toStrictEqual(["1"]);
    expect(events(await onA).map((f) => f.id)).toStrictEqual(["1"]);
  });

  it("an event over the NOTIFY limit is refused with a named error BEFORE notify", async () => {
    const { sql, notified } = fakeSql();
    const rt = createRealtime({ bus: postgresBus(sql) });
    const e = await rt.publish("room", { type: "message", data: "x".repeat(9000), id: "big" }).catch((x) => x);
    expect(e).toBeInstanceOf(RealtimeError);
    expect(e.code).toBe("payload_too_large");
    expect(notified).toStrictEqual([]);
  });
  it("a LISTEN that fails is reported through onError, not left as an unhandled rejection", async () => {
    const errors: unknown[] = [];
    const sql = { listen: async () => { throw new Error("db down"); }, notify: async () => {} };
    const rt = createRealtime({ bus: postgresBus(sql, { onError: (e) => errors.push(e) }) });
    await flush();
    expect(errors.map((e) => (e as Error).message)).toStrictEqual(["db down"]);
    rt.close();
  });
});

describe("presence", () => {
  it("touch → ONE join (not one per touch), expiry → leave, list() between; across two hubs", async () => {
    vi.useFakeTimers();
    const bus = memoryBus();
    const a = createRealtime({ bus, presenceTtlMs: 30_000 });
    const b = createRealtime({ bus, presenceTtlMs: 30_000 });
    const seenB: unknown[] = [];
    const resB = b.stream("room");
    const reader = resB.body!.getReader();
    await a.presence.touch("room", { id: "u1", name: "Anne" });
    await vi.advanceTimersByTimeAsync(10_000);
    await a.presence.touch("room", { id: "u1", name: "Anne" });
    expect(b.presence.list("room")).toStrictEqual([{ id: "u1", name: "Anne" }]);
    await vi.advanceTimersByTimeAsync(29_000); // refreshed at 10 s, so still here at 39 s
    expect(b.presence.list("room").length).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(b.presence.list("room")).toStrictEqual([]);
    vi.useRealTimers();
    let text = "";
    for (let i = 0; i < 12; i++) {
      const r = await Promise.race([reader.read(), new Promise<{ value: undefined }>((ok) => setTimeout(() => ok({ value: undefined }), 30))]);
      if (r.value) text += new TextDecoder().decode(r.value);
    }
    for (const m of text.matchAll(/data: (\{.*\})/g)) {
      const d = JSON.parse(m[1]!);
      if (d.type === "presence") seenB.push(d.data.action);
    }
    expect(seenB).toStrictEqual(["join", "leave"]);
    a.close();
    b.close();
  });

  it("a touch REFRESHES the expiry — someone who keeps touching does not leave", async () => {
    vi.useFakeTimers();
    const rt = createRealtime({ presenceTtlMs: 30_000 });
    await rt.presence.touch("room", { id: "u1" });
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      // Checked BEFORE the next touch: an expiry that was never refreshed has already fired here.
      expect(rt.presence.list("room").map((m) => m.id)).toStrictEqual(["u1"]);
      await rt.presence.touch("room", { id: "u1" });
    }
    expect(rt.presence.list("room").map((m) => m.id)).toStrictEqual(["u1"]);
    rt.close();
  });

  it("leave() ends presence at once", async () => {
    const rt = createRealtime();
    await rt.presence.touch("room", { id: "u1" });
    await rt.presence.leave("room", "u1");
    expect(rt.presence.list("room")).toStrictEqual([]);
    rt.close();
  });
});

describe("live: publish → subscriber", () => {
  it("100 events in-process, p95 under 50 ms", async () => {
    const rt = createRealtime();
    const res = rt.stream("room");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    await flush();
    const lat: number[] = [];
    let buf = "";
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      await rt.publish("room", { type: "message", data: { i }, id: String(i) });
      while (!buf.includes(`"i":${i}}`)) buf += dec.decode((await reader.read()).value);
      lat.push(performance.now() - t0);
    }
    lat.sort((x, y) => x - y);
    const p95 = lat[94]!;
    console.log(`F103.1 publish→stream p95 ${p95.toFixed(2)} ms, max ${lat[99]!.toFixed(2)} ms`);
    expect(p95).toBeLessThan(50);
    reader.cancel();
  });
});

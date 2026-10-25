// F103.6 — helpdesk (#4654): a per-connection first frame, an async transform that
// keeps order, and a heartbeat an external EventSource never dispatches.
import { describe, expect, it, vi } from "vitest";
import { createRealtime, type RealtimeEvent } from "../src/server";

async function readRaw(res: Response, ms = 300): Promise<string> {
  // Keep ONE pending read across timeouts — a fresh read() per tick would drop the
  // chunk an abandoned read later receives, which is exactly what a slow async
  // transform produces.
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    pending ??= reader.read();
    const r = await Promise.race([pending, new Promise<null>((ok) => setTimeout(() => ok(null), 30))]);
    if (r === null) continue;
    pending = null;
    if (r.done) break;
    text += dec.decode(r.value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text;
}
const frames = (text: string) => text.split("\n\n").filter(Boolean);
const flush = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("initial — the connection's own first frames", () => {
  it("is written FIRST, before replay, without an id, as a named event", async () => {
    const rt = createRealtime({ replay: async () => [{ type: "message", data: { n: 1 }, id: "5" }] });
    const text = await readRaw(
      rt.stream("t:1", { lastEventId: "4", named: true, initial: [{ type: "ready", data: { token: "abc" }, id: "IGNORED" }] }),
    );
    const f = frames(text);
    expect(f[0]).toMatch(/^retry: /);
    expect(f[1]).toBe('event: ready\ndata: {"token":"abc"}');
    expect(f[2]).toBe('id: 5\nevent: message\ndata: {"n":1}');
  });

  it("does NOT go through transform — it is the connection's, not the channel's", async () => {
    const rt = createRealtime();
    const transform = vi.fn(() => null);
    const text = await readRaw(rt.stream("t:1", { transform, initial: [{ type: "ready", data: { ok: true } }] }));
    expect(text).toContain('data: {"type":"ready","data":{"ok":true}}');
    expect(transform).not.toHaveBeenCalled();
  });

  it("a hello that publish() would refuse throws at the CALLER (no frame injection)", () => {
    const rt = createRealtime();
    expect(() => rt.stream("t:1", { initial: [{ type: "ready\ndata: forged", data: {} }] })).toThrow();
    expect(() => rt.stream("t:1", { initial: [{ type: "$ping", data: {} }] })).toThrow();
  });
});

describe("async transform — order is kept", () => {
  it("live: the first event is the slowest, and still arrives first", async () => {
    const rt = createRealtime();
    const delays: Record<string, number> = { "1": 80, "2": 0, "3": 20 };
    const transform = async (e: RealtimeEvent) => {
      await sleep(delays[e.id!] ?? 0);
      return e;
    };
    const reading = readRaw(rt.stream("t:1", { transform }), 400);
    await flush();
    for (const id of ["1", "2", "3"]) await rt.publish("t:1", { type: "message", data: { id }, id });
    const ids = frames(await reading).map((f) => /^id: (\d+)/.exec(f)?.[1]).filter(Boolean);
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("replay: same — a slow replayed event holds back the ones after it", async () => {
    const replayed: RealtimeEvent[] = ["1", "2", "3"].map((id) => ({ type: "message", data: { id }, id }));
    const rt = createRealtime({ replay: async () => replayed });
    const transform = async (e: RealtimeEvent) => {
      await sleep(e.id === "1" ? 80 : 0);
      return e;
    };
    const ids = frames(await readRaw(rt.stream("t:1", { lastEventId: "0", transform }), 400))
      .map((f) => /^id: (\d+)/.exec(f)?.[1])
      .filter(Boolean);
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("a REJECTED promise skips the event (a durable one as a bare id) and the stream keeps going", async () => {
    const rt = createRealtime();
    const transform = async (e: RealtimeEvent) => {
      if (e.id === "1") throw new Error("signing failed");
      return e;
    };
    const reading = readRaw(rt.stream("t:1", { transform }));
    await flush();
    await rt.publish("t:1", { type: "message", data: { secret: "x" }, id: "1" });
    await rt.publish("t:1", { type: "message", data: { ok: true }, id: "2" });
    const text = await reading;
    expect(frames(text)).toContain("id: 1");
    expect(text).not.toContain("secret");
    expect(text).toContain('"ok":true');
  });

  it("an async transform's output is still checked like a published event", async () => {
    const rt = createRealtime();
    const reading = readRaw(rt.stream("t:1", { transform: async (e) => ({ ...e, type: "x\ndata: forged" }) }));
    await flush();
    await rt.publish("t:1", { type: "message", data: {}, id: "1" });
    const text = await reading;
    expect(text).not.toContain("forged");
    expect(frames(text)).toContain("id: 1");
  });
});

describe("heartbeat", () => {
  it("'comment' writes an SSE comment and NO $ping data frame", async () => {
    vi.useFakeTimers();
    const rt = createRealtime({ heartbeatMs: 1000 });
    const reader = rt.stream("t:1", { heartbeat: "comment" }).body!.getReader();
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    let text = "";
    for (let i = 0; i < 2; i++) text += new TextDecoder().decode((await reader.read()).value);
    reader.cancel().catch(() => {});
    rt.close();
    expect(text).toContain(": ping\n\n");
    expect(text).not.toContain("$ping");
  });

  it("default is unchanged: a $ping data frame (what @broberg/realtime/client uses as a sign of life)", async () => {
    vi.useFakeTimers();
    const rt = createRealtime({ heartbeatMs: 1000 });
    const reader = rt.stream("t:1").body!.getReader();
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    let text = "";
    for (let i = 0; i < 2; i++) text += new TextDecoder().decode((await reader.read()).value);
    reader.cancel().catch(() => {});
    rt.close();
    expect(text).toContain('data: {"type":"$ping"}');
    expect(text).not.toContain(": ping");
  });
});

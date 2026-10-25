// F103.4 — one channel, a different view per subscriber, and named SSE events.
// helpdesk (#4574, #4582): a visitor sees only visible messages; staff on the same
// ticket see everything; and an external client reads `event: <name>` frames.
import { describe, expect, it, vi } from "vitest";
import { createRealtime, type RealtimeEvent } from "../src/server";
import { connect } from "../src/client";

/** Read the raw SSE text off a stream for `ms`. */
async function readRaw(res: Response, ms = 250): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((ok) => setTimeout(() => ok({ done: true, value: undefined }), 30)),
    ]);
    if (r.value) text += dec.decode(r.value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text;
}
const frames = (text: string) => text.split("\n\n").filter(Boolean);
const flush = () => new Promise((r) => setTimeout(r, 0));

const visitorView = (e: RealtimeEvent): RealtimeEvent | null => {
  const d = e.data as { visible?: boolean; body?: string; note?: string } | undefined;
  if (e.type === "message" && d && d.visible === false) return null;
  if (e.type === "message" && d) return { ...e, data: { body: d.body } }; // strip the staff-only note
  return e;
};

describe("transform — each subscriber gets its own view of ONE channel", () => {
  it("visitor and staff on the same channel receive different bytes for the same events", async () => {
    const rt = createRealtime();
    const visitor = readRaw(rt.stream("ticket:1", { transform: visitorView }));
    const staff = readRaw(rt.stream("ticket:1"));
    await flush();
    await rt.publish("ticket:1", { type: "message", data: { visible: true, body: "hej", note: "VIP" }, id: "1" });
    await rt.publish("ticket:1", { type: "message", data: { visible: false, body: "intern" }, id: "2" });
    const [v, s] = await Promise.all([visitor, staff]);
    expect(v).toContain('id: 1\ndata: {"type":"message","data":{"body":"hej"}}');
    expect(v).not.toContain("VIP");
    expect(v).not.toContain("intern");
    expect(s).toContain('"note":"VIP"');
    expect(s).toContain('"body":"intern"');
  });

  it("REPLAY goes through the transform too — a resume must not leak what live hides", async () => {
    const replayed: RealtimeEvent[] = [
      { type: "message", data: { visible: true, body: "a" }, id: "2" },
      { type: "message", data: { visible: false, body: "hidden" }, id: "3" },
      { type: "message", data: { visible: true, body: "b" }, id: "4" },
    ];
    const rt = createRealtime({ replay: async () => replayed });
    const v = await readRaw(rt.stream("ticket:1", { lastEventId: "1", transform: visitorView }));
    expect(v).toContain('"body":"a"');
    expect(v).toContain('"body":"b"');
    expect(v).not.toContain("hidden");
    // Negative control: without a transform the same replay delivers all three.
    const all = await readRaw(createRealtime({ replay: async () => replayed }).stream("ticket:1", { lastEventId: "1" }));
    expect(all).toContain("hidden");
  });

  it("a skipped DURABLE event is written as a bare id line, so the browser's Last-Event-ID moves past it", async () => {
    const rt = createRealtime();
    const reading = readRaw(rt.stream("ticket:1", { transform: () => null }));
    await flush();
    await rt.publish("ticket:1", { type: "message", data: { body: "x" }, id: "7" });
    await rt.publish("ticket:1", { type: "typing", data: {} }); // ephemeral: nothing at all
    const text = await reading;
    expect(frames(text)).toContain("id: 7");
    expect(text).not.toContain('"body":"x"');
    expect(text).not.toContain("typing");
  });

  it("resuming AFTER a filtered id delivers the next allowed event and never the hidden one", async () => {
    const store: RealtimeEvent[] = [
      { type: "message", data: { visible: false, body: "hidden" }, id: "7" },
      { type: "message", data: { visible: true, body: "later" }, id: "8" },
    ];
    const rt = createRealtime({ replay: async (_c, since) => store.filter((e) => Number(e.id) > Number(since)) });
    const v = await readRaw(rt.stream("ticket:1", { lastEventId: "7", transform: visitorView }));
    expect(v).toContain('"body":"later"');
    expect(v).not.toContain("hidden");
  });

  it("$ping and presence cannot be filtered away — a transform returning null for everything keeps the heartbeat", async () => {
    vi.useFakeTimers();
    const rt = createRealtime({ heartbeatMs: 1000 });
    const transform = vi.fn(() => null);
    const reader = rt.stream("ticket:1", { transform }).body!.getReader();
    await rt.presence.touch("ticket:1", { id: "u1" });
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    let text = "";
    for (let i = 0; i < 3; i++) text += new TextDecoder().decode((await reader.read()).value);
    reader.cancel().catch(() => {});
    rt.close();
    expect(text).toContain('"type":"$ping"');
    expect(text).toContain('"type":"presence"');
    expect(transform).not.toHaveBeenCalled();
  });

  it("a transform that THROWS skips the event (fail closed) and the stream keeps going", async () => {
    const rt = createRealtime();
    const reading = readRaw(
      rt.stream("ticket:1", {
        transform: (e) => {
          if ((e.data as { boom?: boolean }).boom) throw new Error("bug");
          return e;
        },
      }),
    );
    await flush();
    await rt.publish("ticket:1", { type: "message", data: { boom: true, secret: "s" } });
    await rt.publish("ticket:1", { type: "message", data: { body: "after" } });
    const text = await reading;
    expect(text).not.toContain("secret");
    expect(text).toContain('"body":"after"');
  });
});

describe("named — `event: <type>` frames", () => {
  it("writes id + event + the bare data", async () => {
    const rt = createRealtime();
    const reading = readRaw(rt.stream("ticket:1", { named: true }));
    await flush();
    await rt.publish("ticket:1", { type: "message", data: { body: "hej" }, id: "3" });
    await rt.publish("ticket:1", { type: "typing" });
    const text = await reading;
    expect(frames(text)).toContain('id: 3\nevent: message\ndata: {"body":"hej"}');
    expect(frames(text)).toContain("event: typing\ndata: null");
  });

  it("without options the bytes are 0.1.3's: one data line with {type,data}", async () => {
    const rt = createRealtime();
    const reading = readRaw(rt.stream("ticket:1"));
    await flush();
    await rt.publish("ticket:1", { type: "message", data: { body: "hej" }, id: "3" });
    const text = await reading;
    expect(frames(text)).toContain('id: 3\ndata: {"type":"message","data":{"body":"hej"}}');
    expect(text).not.toContain("event:");
  });

  it("connect({ named }) delivers named frames to onEvent exactly like default frames, ids included", () => {
    const listeners = new Map<string, (ev: { data: string; lastEventId?: string }) => void>();
    let es!: ES;
    class ES {
      readyState = 1;
      onopen: ((e: unknown) => void) | null = null;
      onmessage: ((e: { data: string; lastEventId?: string }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor() {
        es = this;
      }
      addEventListener(type: string, fn: (ev: { data: string; lastEventId?: string }) => void) {
        listeners.set(type, fn);
      }
      close() {}
    }
    const got: RealtimeEvent[] = [];
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
    const conn = connect("/s", {
      onEvent: (e) => got.push(e),
      named: ["message", "typing"],
      EventSource: ES as never,
      doc: doc as never,
      win: new EventTarget() as never,
    });
    es.onmessage!({ data: '{"body":"hej"}', lastEventId: "3" }); // `event: message` reaches onmessage
    listeners.get("typing")!({ data: "null", lastEventId: "3" }); // inherited id → delivered id-less (F103.3)
    conn.close();
    expect(got).toEqual([
      { type: "message", data: { body: "hej" }, id: "3" },
      { type: "typing", data: null },
    ]);
    expect([...listeners.keys()]).toEqual(["typing"]); // "message" is onmessage's, never a second listener
  });

  it("an `event: message` frame is delivered ONCE and correctly — a browser fires it on onmessage AND on addEventListener('message')", () => {
    // EventSource dispatches a frame whose type is "message" to onmessage and to every
    // 'message' listener. helpdesk's own types are klar|message|state|typing.
    const listeners = new Map<string, Array<(ev: { data: string; lastEventId?: string }) => void>>();
    let es!: ES;
    class ES {
      readyState = 1;
      onopen: ((e: unknown) => void) | null = null;
      onmessage: ((e: { data: string; lastEventId?: string }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor() {
        es = this;
      }
      addEventListener(type: string, fn: (ev: { data: string; lastEventId?: string }) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      }
      dispatch(type: string, ev: { data: string; lastEventId?: string }) {
        if (type === "message") this.onmessage?.(ev);
        for (const fn of listeners.get(type) ?? []) fn(ev);
      }
      close() {}
    }
    const got: RealtimeEvent[] = [];
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
    const conn = connect("/s", {
      onEvent: (e) => got.push(e),
      named: ["message", "typing"],
      EventSource: ES as never,
      doc: doc as never,
      win: new EventTarget() as never,
    });
    es.dispatch("message", { data: '{"type":"$ping"}' }); // the heartbeat stays a default frame
    es.dispatch("message", { data: '{"body":"hej"}', lastEventId: "3" });
    es.dispatch("typing", { data: '{"who":"a"}', lastEventId: "3" });
    es.dispatch("message", { data: '{"type":"note","body":"x"}', lastEventId: "4" }); // bare data that happens to carry a "type"
    conn.close();
    expect(got).toEqual([
      { type: "message", data: { body: "hej" }, id: "3" },
      { type: "typing", data: { who: "a" } },
      { type: "message", data: { type: "note", body: "x" }, id: "4" },
    ]);
  });
});

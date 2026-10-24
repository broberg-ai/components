// F103.1 — the browser half, against a fake EventSource, document and window.
import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, createOutbox, typingThrottle, type ConnectionState } from "../src/client";

class FakeES {
  static all: FakeES[] = [];
  readyState = 0;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string; lastEventId?: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeES.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(type: string, data?: unknown, id?: string) {
    this.onmessage?.({ data: JSON.stringify({ type, data }), ...(id ? { lastEventId: id } : {}) });
  }
  fail(readyState: number) {
    this.readyState = readyState;
    this.onerror?.({});
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

function env() {
  FakeES.all = [];
  let t = 0;
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const win = new EventTarget();
  return {
    doc,
    win,
    now: () => t,
    advance: (ms: number) => (t += ms),
    es: () => FakeES.all.at(-1)!,
    opts: { EventSource: FakeES as never, doc: doc as never, win: win as never },
  };
}

afterEach(() => vi.useRealTimers());

describe("connect — an id-less event that inherits the previous id (F103.3, jam #4393)", () => {
  // A real EventSource keeps its last-event-id buffer, so an event with no
  // `id:` line arrives with lastEventId === the previous id.
  const inherit = (es: FakeES, type: string, data: unknown, id: string) =>
    es.onmessage?.({ data: JSON.stringify({ type, data }), lastEventId: id });

  it("is delivered (without an id), and lastEventId stays on the real one", () => {
    const e = env();
    const got: unknown[] = [];
    const c = connect("/s", { ...e.opts, now: e.now, onEvent: (ev) => got.push(ev) });
    e.es().open();
    e.es().emit("message", { t: "hej" }, "X");
    inherit(e.es(), "typing", { who: "jam-ai" }, "X");
    expect(got).toStrictEqual([
      { type: "message", data: { t: "hej" }, id: "X" },
      { type: "typing", data: { who: "jam-ai" } },
    ]);
    expect(c.lastEventId).toBe("X");
  });
  it("a genuine duplicate — same id AND same data back to back — is still delivered once", () => {
    const e = env();
    const got: unknown[] = [];
    connect("/s", { ...e.opts, now: e.now, onEvent: (ev) => got.push(ev) });
    e.es().open();
    e.es().emit("message", { t: "hej" }, "X");
    e.es().emit("message", { t: "hej" }, "X");
    e.es().emit("message", { t: "næste" }, "Y");
    expect(got).toStrictEqual([
      { type: "message", data: { t: "hej" }, id: "X" },
      { type: "message", data: { t: "næste" }, id: "Y" },
    ]);
  });
});

describe("connect", () => {
  it("delivers events with their id, ignores $ping, and never delivers the same id twice", () => {
    const e = env();
    const got: unknown[] = [];
    connect("/s", { ...e.opts, now: e.now, onEvent: (ev) => got.push(ev) });
    e.es().open();
    e.es().emit("message", { t: "a" }, "1");
    e.es().emit("$ping");
    e.es().emit("typing", { who: "b" });
    e.es().emit("message", { t: "a" }, "1"); // a replay overlapping what we had
    expect(got).toStrictEqual([
      { type: "message", data: { t: "a" }, id: "1" },
      { type: "typing", data: { who: "b" } },
    ]);
  });

  it("onState: connecting → open; an error while the browser retries → reconnecting", () => {
    const e = env();
    const states: ConnectionState[] = [];
    connect("/s", { ...e.opts, now: e.now, onEvent: () => {}, onState: (s) => states.push(s) });
    e.es().open();
    e.es().fail(0);
    expect(states).toStrictEqual(["connecting", "open", "reconnecting"]);
  });

  it("the page coming back after silence REOPENS with ?lastEventId= (iOS closes the stream in the background)", () => {
    const e = env();
    const c = connect("/s?room=7", { ...e.opts, now: e.now, staleMs: 45_000, onEvent: () => {} });
    e.es().open();
    e.es().emit("message", {}, "41");
    e.doc.visibilityState = "hidden";
    e.advance(60_000);
    e.doc.visibilityState = "visible";
    e.doc.dispatchEvent(new Event("visibilitychange"));
    expect(FakeES.all.length).toBe(2);
    expect(FakeES.all[0]!.closed).toBe(true);
    expect(e.es().url).toBe("/s?room=7&lastEventId=41");
    expect(c.lastEventId).toBe("41");
  });

  it("NEGATIVE CONTROL: visible again while the stream is fresh does NOT reopen", () => {
    const e = env();
    connect("/s", { ...e.opts, now: e.now, onEvent: () => {} });
    e.es().open();
    e.advance(5_000);
    e.doc.dispatchEvent(new Event("visibilitychange"));
    expect(FakeES.all.length).toBe(1);
  });

  it("coming back online reopens a closed stream", () => {
    const e = env();
    connect("/s", { ...e.opts, now: e.now, onEvent: () => {} });
    e.es().open();
    e.es().readyState = 2;
    e.win.dispatchEvent(new Event("online"));
    expect(FakeES.all.length).toBe(2);
  });

  it("a stream the browser gave up on (CLOSED) is reopened after a backoff", () => {
    vi.useFakeTimers();
    const e = env();
    connect("/s", { ...e.opts, now: e.now, onEvent: () => {} });
    e.es().fail(2);
    vi.advanceTimersByTime(999);
    expect(FakeES.all.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(FakeES.all.length).toBe(2);
  });

  it("a stream that goes silent with NO error is reopened by the watchdog", () => {
    vi.useFakeTimers();
    const e = env();
    connect("/s", { ...e.opts, now: e.now, staleMs: 45_000, onEvent: () => {} });
    e.es().open();
    e.advance(46_000);
    vi.advanceTimersByTime(15_000);
    expect(FakeES.all.length).toBe(2);
  });

  it("close() stops everything", () => {
    const e = env();
    const states: ConnectionState[] = [];
    const c = connect("/s", { ...e.opts, now: e.now, onEvent: () => {}, onState: (s) => states.push(s) });
    c.close();
    e.advance(100_000);
    e.doc.dispatchEvent(new Event("visibilitychange"));
    expect(FakeES.all.length).toBe(1);
    expect(states.at(-1)).toBe("closed");
  });
});

describe("createOutbox — the message shows at once and never twice", () => {
  it("send() is pending SYNCHRONOUSLY; the echo reconciles it away, so it is shown once", async () => {
    let resolve!: () => void;
    const changes: string[][] = [];
    const ob = createOutbox<string>({
      post: () => new Promise<void>((r) => (resolve = r)),
      onChange: (items) => changes.push(items.map((i) => `${i.payload}:${i.state}`)),
      newId: () => "c1",
    });
    const item = ob.send("hej");
    expect(item.state).toBe("pending");
    expect(ob.items.map((i) => i.state)).toStrictEqual(["pending"]);
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(ob.items.map((i) => i.state)).toStrictEqual(["sent"]);
    expect(ob.reconcile("c1")).toBe(true);
    expect(ob.items).toStrictEqual([]);
    expect(changes).toStrictEqual([["hej:pending"], ["hej:sent"], []]);
  });

  it("the echo can beat the POST's answer — the item is not resurrected", async () => {
    let resolve!: () => void;
    const ob = createOutbox<string>({ post: () => new Promise<void>((r) => (resolve = r)), onChange: () => {}, newId: () => "c2" });
    ob.send("hej");
    expect(ob.reconcile("c2")).toBe(true);
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(ob.items).toStrictEqual([]);
  });

  it("a failed POST is visible as failed and can be retried", async () => {
    let fail = true;
    const ob = createOutbox<string>({ post: async () => { if (fail) throw new Error("offline"); }, onChange: () => {}, newId: () => "c3" });
    ob.send("hej");
    await new Promise((r) => setTimeout(r, 0));
    expect(ob.items).toStrictEqual([{ clientId: "c3", payload: "hej", state: "failed", error: "offline" }]);
    fail = false;
    ob.retry("c3");
    expect(ob.items[0]!.state).toBe("pending");
    await new Promise((r) => setTimeout(r, 0));
    expect(ob.items[0]!.state).toBe("sent");
  });

  it("reconcile of someone else's message returns false and changes nothing", () => {
    const ob = createOutbox<string>({ post: async () => {}, onChange: () => {}, newId: () => "mine" });
    ob.send("x");
    expect(ob.reconcile("theirs")).toBe(false);
    expect(ob.items.length).toBe(1);
  });
});

describe("typingThrottle", () => {
  it("at most one 'typing' per interval, one stop when it ends, no stop if never started", () => {
    let t = 0;
    const sent: boolean[] = [];
    const tt = typingThrottle((a) => sent.push(a), { intervalMs: 3000, now: () => t });
    tt.stop();
    tt.typing();
    t = 1000;
    tt.typing();
    t = 3000;
    tt.typing();
    tt.stop();
    tt.stop();
    expect(sent).toStrictEqual([true, true, false]);
  });
});

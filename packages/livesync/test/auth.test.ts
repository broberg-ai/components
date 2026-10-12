// F100.2 — login before the first sync, and read-only access.
// The network is in memory: each FakeSocket is wired to the real server through
// createLivesync({ insecureNoAuth: true }).connect(), with delivery deferred so messages genuinely interleave.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createLivesync, type Livesync } from "../src/server";
import { connect, type SocketLike, type LiveDoc } from "../src/client";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));
async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await tick();
}

/** A socket factory that dials the in-memory server. */
function network(server: Livesync) {
  const sockets: FakeSocket[] = [];
  class FakeSocket implements SocketLike {
    binaryType = "arraybuffer";
    readyState = 0;
    onopen: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    private handle?: ReturnType<Livesync["connect"]>;
    constructor(url: string) {
      sockets.push(this);
      const docId = url.split("/").pop()!;
      setTimeout(() => {
        this.readyState = 1;
        this.handle = server.connect(docId, {
          send: (data) => setTimeout(() => this.readyState === 1 && this.onmessage?.({ data: data.slice().buffer }), 1),
          // Like a real WebSocket: what the server sent before closing still arrives, THEN the close.
          close: () => setTimeout(() => this.close(), 2),
        });
        this.onopen?.({});
      }, 1);
    }
    send(data: Uint8Array) {
      const copy = data.slice();
      setTimeout(() => this.readyState === 1 && this.handle?.message(copy), 1);
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.handle?.closed();
      setTimeout(() => this.onclose?.({}), 1);
    }
  }
  return { factory: (url: string) => new FakeSocket(url), sockets };
}

// Content, with map keys sorted: a Y.Map's key ORDER is local insertion order, not content.
const sortKeys = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
import { MESSAGE_DENIED, messageType, encodeAuth, encodeSyncStep1, encodeUpdate } from "../src/protocol";
import type { Principal } from "../src/server";

/** A connection that records every byte the server sent it. */
function recorder() {
  const sent: Uint8Array[] = [];
  let closed = false;
  return { sent, get closed() { return closed; }, conn: { send: (d: Uint8Array) => { sent.push(d.slice()); }, close: () => { closed = true; } } };
}
const USERS: Record<string, Principal> = { "token-anna": { sub: "anna", access: "write" }, "token-bo": { sub: "bo", access: "read" } };
const authorize = async (token: string) => USERS[token] ?? null;

describe("F100.2 — no login, no document", () => {
  it("the server refuses to start without a login check (no silent open default)", () => {
    expect(() => createLivesync()).toThrow(/authorize/);
  });

  it("an invalid token receives exactly ONE message — DENIED — and not a byte of the document", async () => {
    const server = createLivesync({ authorize });
    // Someone with access has written something first.
    const owner = recorder();
    const h = server.connect("secret", owner.conn);
    h.message(encodeAuth("token-anna"));
    await tick();
    const doc = new Y.Doc();
    doc.getMap("mindmap").set("plan", "hemmelig");
    h.message(encodeUpdate(Y.encodeStateAsUpdate(doc)));
    expect(server.doc("secret")!.getMap("mindmap").get("plan")).toBe("hemmelig");

    const intruder = recorder();
    const x = server.connect("secret", intruder.conn);
    x.message(encodeAuth("token-forged"));
    x.message(encodeSyncStep1(new Y.Doc())); // asks for everything
    await tick();
    expect(intruder.sent.map((m) => messageType(m))).toStrictEqual([MESSAGE_DENIED]);
    expect(intruder.sent[0]!.byteLength).toBe(1);
    expect(intruder.closed).toBe(true);
  });

  it("a client that skips the login and asks to sync is refused the same way", async () => {
    const server = createLivesync({ authorize });
    const r = recorder();
    server.connect("d", r.conn).message(encodeSyncStep1(new Y.Doc()));
    await tick();
    expect(r.sent.map((m) => messageType(m))).toStrictEqual([MESSAGE_DENIED]);
  });

  it("a login check that throws is a refusal, never an open door", async () => {
    const server = createLivesync({ authorize: async () => { throw new Error("BID down"); } });
    const r = recorder();
    server.connect("d", r.conn).message(encodeAuth("token-anna"));
    await tick();
    expect(r.sent.map((m) => messageType(m))).toStrictEqual([MESSAGE_DENIED]);
  });

  it("the client sends the token first, and a refused client stops retrying (state «denied»)", async () => {
    const server = createLivesync({ authorize });
    const net = network(server);
    let asked = 0;
    const c = connect({ url: "ws://x/sync/d", socket: net.factory, minDelayMs: 5, getToken: async () => { asked++; return "token-forged"; } });
    await settle(30);
    expect(c.state).toBe("denied");
    expect(net.sockets).toHaveLength(1); // no reconnect storm with a token that will not work
    expect(asked).toBe(1);
    c.destroy();
  });
});

describe("F100.2 — read and write per user", () => {
  it("a read-only user sees every change, but their own edits never reach the document — checked on the server copy AND a fresh load", async () => {
    const server = createLivesync({ authorize });
    const net = network(server);
    const anna = connect({ url: "ws://x/sync/m", socket: net.factory, getToken: async () => "token-anna" });
    const bo = connect({ url: "ws://x/sync/m", socket: net.factory, getToken: async () => "token-bo" });
    await settle();
    expect([anna.state, bo.state]).toStrictEqual(["synced", "synced"]);

    anna.doc.getMap("mindmap").set("title", "Annas kort");
    bo.doc.getMap("mindmap").set("vandalism", "bo was here");
    bo.doc.getArray("nodes").push([{ id: "bo-node" }]);
    await settle();

    expect(bo.doc.getMap("mindmap").get("title")).toBe("Annas kort"); // bo still receives
    const s = server.doc("m")!;
    expect(s.getMap("mindmap").toJSON()).toStrictEqual({ title: "Annas kort" });
    expect(s.getArray("nodes").length).toBe(0);
    expect(anna.doc.getMap("mindmap").get("vandalism")).toBeUndefined();

    const fresh = connect({ url: "ws://x/sync/m", socket: net.factory, getToken: async () => "token-anna" });
    await settle();
    expect(fresh.doc.getMap("mindmap").toJSON()).toStrictEqual({ title: "Annas kort" });
    expect(fresh.doc.getArray("nodes").length).toBe(0);
    for (const c of [anna, bo, fresh]) c.destroy();
  });
});

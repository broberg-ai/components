// F100.1 — two editors converge, and an editor who was offline merges without loss.
// The network is in memory: each FakeSocket is wired to the real server through
// createLivesync().connect(), with delivery deferred so messages genuinely interleave.
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
          close: () => this.close(),
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
const json = (d: Y.Doc) => JSON.stringify({ map: sortKeys(d.getMap("mindmap").toJSON()), list: d.getArray("nodes").toJSON() });
const sv = (d: Y.Doc) => Buffer.from(Y.encodeStateVector(d)).toString("hex");

describe("F100.1 — two editors at the same time", () => {
  it("concurrent edits on both sides end identical on the SERVER's copy and on both clients", async () => {
    const server = createLivesync();
    const net = network(server);
    const a = connect({ url: "ws://x/sync/jam-1", socket: net.factory });
    const b = connect({ url: "ws://x/sync/jam-1", socket: net.factory });
    await settle();
    expect([a.state, b.state]).toStrictEqual(["synced", "synced"]);

    // Both edit before either has heard from the other.
    a.doc.getMap("mindmap").set("title", "Idé A");
    a.doc.getArray("nodes").push([{ id: "n1", type: "idea" }]);
    b.doc.getMap("mindmap").set("owner", "B");
    b.doc.getArray("nodes").push([{ id: "n2", type: "question" }]);
    await settle();

    const s = server.doc("jam-1")!;
    expect(json(s)).toBe(json(a.doc));
    expect(json(s)).toBe(json(b.doc));
    expect(sv(s)).toBe(sv(a.doc));
    expect(sv(s)).toBe(sv(b.doc));
    // Nothing lost: both titles and both nodes are there.
    const nodes = s.getArray("nodes").toJSON() as { id: string }[];
    expect(nodes.map((n) => n.id).sort()).toStrictEqual(["n1", "n2"]);
    expect(s.getMap("mindmap").toJSON()).toStrictEqual({ title: "Idé A", owner: "B" });
    a.destroy();
    b.destroy();
  });

  it("the same key edited on both sides resolves to ONE value everywhere (no split brain)", async () => {
    const server = createLivesync();
    const net = network(server);
    const a = connect({ url: "ws://x/sync/k", socket: net.factory });
    const b = connect({ url: "ws://x/sync/k", socket: net.factory });
    await settle();
    a.doc.getMap("mindmap").set("title", "A's title");
    b.doc.getMap("mindmap").set("title", "B's title");
    await settle();
    const v = server.doc("k")!.getMap("mindmap").get("title");
    expect(["A's title", "B's title"]).toContain(v);
    expect(a.doc.getMap("mindmap").get("title")).toBe(v);
    expect(b.doc.getMap("mindmap").get("title")).toBe(v);
    a.destroy();
    b.destroy();
  });
});

describe("F100.1 — offline and back (owner 12/10: «ja offline»)", () => {
  it("A edits offline while B edits online; after reconnect nothing is lost on any side", async () => {
    const server = createLivesync();
    const net = network(server);
    const a: LiveDoc = connect({ url: "ws://x/sync/jam-2", socket: net.factory, minDelayMs: 5 });
    const b: LiveDoc = connect({ url: "ws://x/sync/jam-2", socket: net.factory, minDelayMs: 5 });
    await settle();
    a.doc.getArray("nodes").push([{ id: "before" }]);
    await settle();

    a.disconnect();
    await settle(3);
    expect(a.state).toBe("offline");
    a.doc.getArray("nodes").push([{ id: "a-offline-1" }, { id: "a-offline-2" }]);
    a.doc.getMap("mindmap").set("note", "skrevet i toget");
    b.doc.getArray("nodes").push([{ id: "b-online" }]);
    await settle();
    // While A is away, the server has B's edit and NOT A's.
    const ids = (d: Y.Doc) => (d.getArray("nodes").toJSON() as { id: string }[]).map((n) => n.id).sort();
    expect(ids(server.doc("jam-2")!)).toStrictEqual(["b-online", "before"]);

    a.reconnect();
    await settle();
    expect(a.state).toBe("synced");
    const all = ["a-offline-1", "a-offline-2", "b-online", "before"];
    expect(ids(server.doc("jam-2")!)).toStrictEqual(all);
    expect(ids(a.doc)).toStrictEqual(all);
    expect(ids(b.doc)).toStrictEqual(all);
    expect(b.doc.getMap("mindmap").get("note")).toBe("skrevet i toget");
    expect(sv(a.doc)).toBe(sv(server.doc("jam-2")!));
    a.destroy();
    b.destroy();
  });

  it("a dropped connection (not chosen) reconnects by itself and catches up", async () => {
    const server = createLivesync();
    const net = network(server);
    const a = connect({ url: "ws://x/sync/jam-3", socket: net.factory, minDelayMs: 5 });
    const b = connect({ url: "ws://x/sync/jam-3", socket: net.factory, minDelayMs: 5 });
    await settle();
    net.sockets[0]!.close(); // the network drops A
    a.doc.getMap("mindmap").set("while-dropped", true);
    await settle(30);
    expect(a.state).toBe("synced");
    expect(b.doc.getMap("mindmap").get("while-dropped")).toBe(true);
    a.destroy();
    b.destroy();
  });
});

describe("F100.1 — a broken client cannot take the server down", () => {
  it("a malformed message closes THAT connection; the room and the other editors carry on", async () => {
    const server = createLivesync();
    let closed = 0;
    const bad = server.connect("r", { send: () => {}, close: () => { closed++; } });
    expect(() => bad.message(new Uint8Array([9, 1, 2, 3]))).not.toThrow();      // unknown type
    expect(() => bad.message(new Uint8Array([0, 0, 255, 255, 255]))).not.toThrow(); // truncated sync
    expect(closed).toBe(2);
    const net = network(server);
    const a = connect({ url: "ws://x/sync/r", socket: net.factory });
    const b = connect({ url: "ws://x/sync/r", socket: net.factory });
    await settle();
    a.doc.getMap("mindmap").set("ok", 1);
    await settle();
    expect(b.doc.getMap("mindmap").get("ok")).toBe(1);
    a.destroy();
    b.destroy();
  });
});

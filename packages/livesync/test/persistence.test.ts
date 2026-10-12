// F100.3 — documents live in the app's own store, idle rooms leave memory, and
// the browser keeps offline edits across a closed tab. Every assertion about
// what was SAVED reads the store back through load() into a fresh Y.Doc — never
// the server's in-memory copy, which is exactly what a broken save would leave intact.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createLivesync, type Persistence, type Principal } from "../src/server";
import { connect } from "../src/client";
import { network, nowhere, settle, tick } from "./net";

/** The app's database, in memory. Counts stores so a test can see one happen. */
function memoryStore(opts: { storeDelayMs?: number } = {}) {
  const rows = new Map<string, Uint8Array>();
  let stores = 0;
  const p: Persistence & { stores: () => number } = {
    async load(id) {
      return rows.get(id) ?? null;
    },
    async store(id, state) {
      if (opts.storeDelayMs) await tick(opts.storeDelayMs);
      rows.set(id, state.slice());
      stores++;
    },
    stores: () => stores,
  };
  return p;
}
/** What a FRESH load of the store holds. */
async function readBack(p: Persistence, id: string) {
  const d = new Y.Doc();
  const saved = await p.load(id);
  if (saved) Y.applyUpdate(d, saved);
  return d;
}
const ids = (d: Y.Doc) => (d.getArray("nodes").toJSON() as { id: string }[]).map((n) => n.id).sort();

describe("F100.3 AC1 — edited, left, unloaded, reopened", () => {
  it("the room leaves memory after the last editor, and the edit comes back from load()", async () => {
    const store = memoryStore();
    const server = createLivesync({ insecureNoAuth: true, persistence: store, storeDebounceMs: 10, unloadAfterIdleMs: 20 });
    const net = network(server);
    const nonce = `titel-${Date.now()}`;
    const a = connect({ url: "ws://x/sync/jam-p1", socket: net.factory });
    await settle();
    a.doc.getMap("mindmap").set("title", nonce);
    a.doc.getArray("nodes").push([{ id: "n1", type: "idea" }]);
    await settle();
    a.destroy();
    await settle();

    expect(server.doc("jam-p1")).toBeUndefined(); // really out of memory
    const saved = await readBack(store, "jam-p1");
    expect(saved.getMap("mindmap").get("title")).toBe(nonce);
    expect(ids(saved)).toStrictEqual(["n1"]);

    // A new editor with an empty doc gets it from the store, via the server.
    const b = connect({ url: "ws://x/sync/jam-p1", socket: net.factory });
    await settle();
    expect(b.state).toBe("synced");
    expect(b.doc.getMap("mindmap").get("title")).toBe(nonce);
    expect(ids(b.doc)).toStrictEqual(["n1"]);
    b.destroy();
  });

  it("negative control: a document nobody edited is not stored, and an empty store opens an empty document", async () => {
    const store = memoryStore();
    const server = createLivesync({ insecureNoAuth: true, persistence: store, storeDebounceMs: 10, unloadAfterIdleMs: 20 });
    const net = network(server);
    const a = connect({ url: "ws://x/sync/empty", socket: net.factory });
    await settle();
    expect(a.doc.getMap("mindmap").toJSON()).toStrictEqual({});
    a.destroy();
    await settle();
    expect(server.doc("empty")).toBeUndefined();
    expect(store.stores()).toBe(0);
    expect(await store.load("empty")).toBeNull();
  });

  it("an editor who arrives while the last store is still being written still gets that edit", async () => {
    const store = memoryStore({ storeDelayMs: 60 });
    const server = createLivesync({ insecureNoAuth: true, persistence: store, storeDebounceMs: 1000, unloadAfterIdleMs: 10 });
    const net = network(server);
    const a = connect({ url: "ws://x/sync/race", socket: net.factory });
    await settle();
    a.doc.getMap("mindmap").set("k", "sidste ændring");
    await settle(2);
    a.destroy();
    await tick(30); // unload has started; its store (60 ms) has not landed
    expect(server.doc("race")).toBeUndefined();
    expect(await store.load("race")).toBeNull();
    const b = connect({ url: "ws://x/sync/race", socket: net.factory });
    await settle(30);
    expect(b.doc.getMap("mindmap").get("k")).toBe("sidste ændring");
    b.destroy();
  });

  it("several edits within the debounce become ONE store", async () => {
    const store = memoryStore();
    const server = createLivesync({ insecureNoAuth: true, persistence: store, storeDebounceMs: 80, unloadAfterIdleMs: 10_000 });
    const net = network(server);
    const a = connect({ url: "ws://x/sync/deb", socket: net.factory });
    await settle();
    for (let i = 0; i < 5; i++) a.doc.getArray("nodes").push([{ id: `n${i}` }]);
    await settle(6);
    expect(store.stores()).toBe(0);
    await tick(100);
    expect(store.stores()).toBe(1);
    expect(ids(await readBack(store, "deb"))).toStrictEqual(["n0", "n1", "n2", "n3", "n4"]);
    a.destroy();
  });

  it("flush() stores at once — what an app calls before a deploy restarts it", async () => {
    const store = memoryStore();
    const server = createLivesync({ insecureNoAuth: true, persistence: store, storeDebounceMs: 60_000 });
    const net = network(server);
    const a = connect({ url: "ws://x/sync/fl", socket: net.factory });
    await settle();
    a.doc.getMap("mindmap").set("x", 1);
    await settle();
    expect(await store.load("fl")).toBeNull();
    await server.flush();
    expect((await readBack(store, "fl")).getMap("mindmap").get("x")).toBe(1);
    a.destroy();
  });
});

describe("F100.3 — a failing database never loses or fakes a document", () => {
  it("a failed store keeps the room in memory and retries; the edit is stored once the database is back", async () => {
    const store = memoryStore();
    let down = true;
    const errors: string[] = [];
    const flaky: Persistence = {
      load: store.load,
      async store(id, s) {
        if (down) throw new Error("db down");
        return store.store(id, s);
      },
    };
    const server = createLivesync({ insecureNoAuth: true, persistence: flaky, storeDebounceMs: 10, unloadAfterIdleMs: 20, onError: (e, id) => errors.push(`${id}:${(e as Error).message}`) });
    const net = network(server);
    const a = connect({ url: "ws://x/sync/fl2", socket: net.factory });
    await settle();
    a.doc.getMap("mindmap").set("v", "gem mig");
    await settle();
    a.destroy();
    await settle();
    expect(errors.length).toBeGreaterThan(0);
    expect(server.doc("fl2")?.getMap("mindmap").get("v")).toBe("gem mig"); // still held, not dropped
    down = false;
    await settle(10);
    expect(server.doc("fl2")).toBeUndefined();
    expect((await readBack(store, "fl2")).getMap("mindmap").get("v")).toBe("gem mig");
  });

  it("a failed load closes the connection and sends no document (an empty one would overwrite the real one)", async () => {
    const errors: unknown[] = [];
    const server = createLivesync({
      insecureNoAuth: true,
      persistence: { load: async () => { throw new Error("db down"); }, store: async () => {} },
      onError: (e) => errors.push(e),
    });
    const sent: Uint8Array[] = [];
    let closed = false;
    server.connect("x", { send: (d) => sent.push(d), close: () => { closed = true; } });
    await settle(3);
    expect(closed).toBe(true);
    expect(sent).toStrictEqual([]);
    expect(errors).toHaveLength(1);
    expect(server.doc("x")).toBeUndefined();
  });
});

describe("F100.3 AC3 — a read-only user's change never reaches the STORED document", () => {
  it("after store + unload, load() has the writer's change and not the reader's", async () => {
    const USERS: Record<string, Principal> = { "token-anna": { sub: "anna", access: "write" }, "token-bo": { sub: "bo", access: "read" } };
    const store = memoryStore();
    const server = createLivesync({ authorize: async (t) => USERS[t] ?? null, persistence: store, storeDebounceMs: 10, unloadAfterIdleMs: 20 });
    const net = network(server);
    const anna = connect({ url: "ws://x/sync/ro", socket: net.factory, getToken: async () => "token-anna" });
    const bo = connect({ url: "ws://x/sync/ro", socket: net.factory, getToken: async () => "token-bo" });
    await settle();
    expect([anna.state, bo.state]).toStrictEqual(["synced", "synced"]);
    anna.doc.getArray("nodes").push([{ id: "anna-skrev" }]);
    bo.doc.getArray("nodes").push([{ id: "bo-forsøgte" }]);
    await settle();
    anna.destroy();
    bo.destroy();
    await settle();
    expect(server.doc("ro")).toBeUndefined();
    expect(ids(await readBack(store, "ro"))).toStrictEqual(["anna-skrev"]);
  });
});

describe("F100.3 — offline edits survive a closed tab (IndexedDB)", () => {
  it("edited offline, tab closed, reopened online: the edit reaches the server's store", async () => {
    const name = `jam:anna:tab-${Date.now()}`;
    const t1 = connect({ url: "ws://x/sync/tab", socket: nowhere, offlineStore: name, minDelayMs: 60_000 });
    await t1.whenLoaded;
    t1.doc.getArray("nodes").push([{ id: "skrevet-i-toget" }]);
    await settle(4); // y-indexeddb writes each update as it happens
    t1.destroy(); // the tab is closed — the in-memory doc is gone

    const store = memoryStore();
    const server = createLivesync({ insecureNoAuth: true, persistence: store, storeDebounceMs: 10 });
    const net = network(server);
    const t2 = connect({ url: "ws://x/sync/tab", socket: net.factory, offlineStore: name });
    await t2.whenLoaded;
    expect(ids(t2.doc)).toStrictEqual(["skrevet-i-toget"]);
    await settle();
    await server.flush();
    expect(ids(await readBack(store, "tab"))).toStrictEqual(["skrevet-i-toget"]);
    t2.destroy();
  });

  it("clearOfflineStore() (logout) removes the browser's copy — negative control for the test above", async () => {
    const name = `jam:anna:clear-${Date.now()}`;
    const t1 = connect({ url: "ws://x/sync/c", socket: nowhere, offlineStore: name, minDelayMs: 60_000 });
    await t1.whenLoaded;
    t1.doc.getMap("mindmap").set("hemmelig", "ja");
    await settle(4);
    await t1.clearOfflineStore();
    t1.destroy();
    const t2 = connect({ url: "ws://x/sync/c", socket: nowhere, offlineStore: name, minDelayMs: 60_000 });
    await t2.whenLoaded;
    expect(t2.doc.getMap("mindmap").toJSON()).toStrictEqual({});
    t2.destroy();
  });
});

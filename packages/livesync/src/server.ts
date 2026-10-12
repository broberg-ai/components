// @broberg/livesync/server — F100.1. One room per document; every
// connection's changes are merged into the room's copy and sent on to the
// others. Transport-agnostic: anything that can send bytes and be closed is
// a connection (a Bun/Hono WebSocket, or an in-memory pair in a test). Auth
// (F100.2) and persistence (F100.3) are hooks the app passes in.
//
// One server per app (owner 12/10): this runs INSIDE the consumer's app, and
// the documents live in the consumer's database — never in a shared service.
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { encodeAwareness, encodeDenied, encodeSyncStep1, encodeUpdate, handleMessage, isWrite, messageType, MESSAGE_AUTH, readAuth } from "./protocol";

export interface Connection {
  send(data: Uint8Array): void;
  close(): void;
}

export interface ConnectionHandle {
  /** Feed every binary message the client sends. */
  message(data: Uint8Array): void;
  /** Call when the socket closes. */
  closed(): void;
}

interface Room {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<Connection, Set<number>>;
  /** Changed since the last successful store. */
  dirty: boolean;
  storeTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
}

/** Who is on the other end, as the app's login check decided. */
export interface Principal {
  sub: string;
  /** "read": receives the document and every change, but its own changes are dropped. */
  access: "read" | "write";
}

export interface LivesyncOptions {
  /**
   * F100.2 — the app's login check, given the token the client sent first and
   * the document asked for. Return who it is and what they may do, or null to
   * refuse. Typically @broberg/sso's createTicketVerifier (a BID user ticket)
   * plus the app's own "may this user open this document" lookup.
   */
  authorize?: (token: string, docId: string) => Promise<Principal | null>;
  /**
   * Run with NO login check — every connection may read and write everything.
   * Only for tests and local examples; there is no default, so forgetting
   * `authorize` is a startup error rather than an open server.
   */
  insecureNoAuth?: true;
  /**
   * F100.3 — where documents live: the app's OWN database (owner 12/10, one
   * server per app). `load` is asked once when a room opens; `store` gets the
   * whole document state (a Yjs update), debounced after changes, before an
   * idle room is dropped from memory, and on flush(). Without it the room
   * lives in memory only and is never unloaded.
   */
  persistence?: Persistence;
  /** Store at most this often while a document is being edited. Default 2000 ms. */
  storeDebounceMs?: number;
  /** Drop a room from memory this long after its last editor left (it is stored first). Default 60 000 ms. */
  unloadAfterIdleMs?: number;
  /** A failed load/store. Default console.error. A room whose store failed stays in memory and is retried. */
  onError?: (err: unknown, docId: string) => void;
}

export interface Persistence {
  load(docId: string): Promise<Uint8Array | null>;
  store(docId: string, state: Uint8Array): Promise<void>;
}

export interface Livesync {
  /** Attach a connection to the document `docId`; the server opens with sync step 1. */
  connect(docId: string, conn: Connection): ConnectionHandle;
  /** The room's current copy — what every connection converges to. undefined when no one is connected. */
  doc(docId: string): Y.Doc | undefined;
  /** Store every changed document now — call before the app shuts down (e.g. on SIGTERM in a deploy). */
  flush(): Promise<void>;
}

export function createLivesync(options: LivesyncOptions = {}): Livesync {
  if (!options.authorize && !options.insecureNoAuth) {
    throw new Error("livesync: pass `authorize` (the login check) — or `insecureNoAuth: true` for a test; an unauthenticated server is never the default");
  }
  const authorize = options.authorize;
  const persistence = options.persistence;
  const storeDebounceMs = options.storeDebounceMs ?? 2000;
  const unloadAfterIdleMs = options.unloadAfterIdleMs ?? 60_000;
  const onError = options.onError ?? ((err, docId) => console.error(`livesync: storage failed for ${docId}`, err));
  const rooms = new Map<string, Room>();
  const LOADED = {}; // the origin of the state applied from load() — not a change, so not re-stored
  // A room being loaded: every connection for it waits on the same load.
  const opening = new Map<string, Promise<Room>>();
  // The last store of an unloaded room — a reopen must not load() before it has landed.
  const lastStore = new Map<string, Promise<void>>();

  // Synchronous when the room is in memory or there is no store — so a server
  // without persistence behaves exactly as before F100.3.
  function room(docId: string): Room | Promise<Room> {
    const r = rooms.get(docId);
    if (r) return r;
    if (!persistence) {
      const fresh = newRoom(docId);
      rooms.set(docId, fresh);
      return fresh;
    }
    let p = opening.get(docId);
    if (p) return p;
    p = (async () => {
      await lastStore.get(docId);
      // That store failed, so the unload put its room back: use it, never a stale load.
      const kept = rooms.get(docId);
      if (kept) return kept;
      const saved = await persistence.load(docId);
      const fresh = newRoom(docId);
      if (saved && saved.length) Y.applyUpdate(fresh.doc, saved, LOADED);
      rooms.set(docId, fresh);
      return fresh;
    })();
    opening.set(docId, p);
    p.finally(() => opening.delete(docId)).catch(() => {});
    return p;
  }

  async function store(docId: string, r: Room): Promise<boolean> {
    clearTimeout(r.storeTimer);
    r.storeTimer = undefined;
    if (!persistence || !r.dirty) return true;
    r.dirty = false; // changes made while this store runs mark it dirty again
    try {
      await persistence.store(docId, Y.encodeStateAsUpdate(r.doc));
      return true;
    } catch (err) {
      r.dirty = true;
      onError(err, docId);
      scheduleStore(docId, r);
      return false;
    }
  }

  function scheduleStore(docId: string, r: Room): void {
    if (!persistence || r.storeTimer) return;
    r.storeTimer = setTimeout(() => void store(docId, r), storeDebounceMs);
  }

  function scheduleUnload(docId: string, r: Room): void {
    if (!persistence) return; // nowhere to keep it — unloading would throw the document away
    clearTimeout(r.idleTimer);
    r.idleTimer = setTimeout(async () => {
      r.idleTimer = undefined;
      if (r.conns.size || rooms.get(docId) !== r) return;
      // Out of the map FIRST, so a connection arriving now opens a fresh room —
      // which waits for this store before it loads.
      rooms.delete(docId);
      const done = store(docId, r);
      lastStore.set(docId, done.then(() => {}));
      if (await done) {
        r.awareness.destroy();
        r.doc.destroy();
      } else {
        rooms.set(docId, r); // not saved: keep it in memory rather than lose it, try again later
        scheduleUnload(docId, r);
      }
      lastStore.delete(docId);
    }, unloadAfterIdleMs);
  }

  function newRoom(docId: string): Room {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // the server is not a participant
    const fresh: Room = { doc, awareness, conns: new Map(), dirty: false };
    // Every change to the room's copy goes to everyone except the connection it came from.
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === LOADED) return; // nobody is connected while it loads, and it is already stored
      fresh.dirty = true;
      scheduleStore(docId, fresh);
      const msg = encodeUpdate(update);
      for (const c of fresh.conns.keys()) if (c !== origin) safeSend(c, msg);
    });
    awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      const ids = origin instanceof Object && fresh.conns.get(origin as Connection);
      if (ids) {
        for (const id of added) ids.add(id);
        for (const id of removed) ids.delete(id);
      }
      const msg = encodeAwareness(awareness, changed);
      for (const c of fresh.conns.keys()) safeSend(c, msg);
    });
    return fresh;
  }

  function safeSend(c: Connection, msg: Uint8Array): void {
    try {
      c.send(msg);
    } catch {
      c.close(); // a socket that cannot take a message is dead; its close handler removes it
    }
  }

  return {
    connect(docId, conn) {
      // Until the login check has answered, the client gets NOTHING — not even
      // sync step 1, which would reveal what the document holds.
      let principal: Principal | null = authorize ? null : { sub: "insecure", access: "write" };
      let joined = false;
      let dead = false;
      let authStarted = false;
      const pending: Uint8Array[] = [];
      let r: Room | undefined;

      const join = async () => {
        let opened: Room;
        try {
          const got = room(docId);
          opened = got instanceof Promise ? await got : got;
        } catch (err) {
          // Could not read the document: closing is honest, an empty one would be overwritten on the next store.
          onError(err, docId);
          dead = true;
          conn.close();
          return;
        }
        if (dead) {
          if (!opened.conns.size) scheduleUnload(docId, opened); // left while it loaded
          return;
        }
        r = opened;
        clearTimeout(r.idleTimer);
        r.idleTimer = undefined;
        r.conns.set(conn, new Set());
        joined = true;
        safeSend(conn, encodeSyncStep1(r.doc));
        const states = [...r.awareness.getStates().keys()];
        if (states.length) safeSend(conn, encodeAwareness(r.awareness, states));
        for (const m of pending.splice(0)) handle(m);
      };
      const refuse = () => {
        dead = true;
        safeSend(conn, encodeDenied());
        conn.close();
      };
      const handle = (data: Uint8Array) => {
        if (!r || !principal) return;
        // A read-only user still receives everything; what they would change is dropped here.
        if (principal.access === "read" && isWrite(data)) return;
        let reply: Uint8Array | null;
        try {
          ({ reply } = handleMessage(data, r.doc, r.awareness, conn));
        } catch {
          // A malformed or unknown message must not throw into the app's socket
          // handler (one bad client would take the server down): drop that client.
          conn.close();
          return;
        }
        if (reply) safeSend(conn, reply);
      };

      if (!authorize) void join();

      return {
        message(data) {
          if (dead) return;
          if (joined) return handle(data);
          if (authStarted || !authorize) {
            pending.push(data.slice()); // sync step 1 etc. arriving while the check or the load runs
            return;
          }
          // The first message must be the login.
          let token: string | null = null;
          try {
            token = messageType(data) === MESSAGE_AUTH ? readAuth(data) : null;
          } catch {
            token = null;
          }
          if (token === null) return refuse();
          authStarted = true;
          authorize(token, docId).then(
            (p) => {
              if (dead) return;
              if (!p) return refuse();
              principal = p;
              void join();
            },
            () => refuse(), // a login check that throws is a refusal, never an open door
          );
        },
        closed() {
          dead = true;
          if (!r) return;
          const ids = r.conns.get(conn);
          r.conns.delete(conn);
          if (ids?.size) awarenessProtocol.removeAwarenessStates(r.awareness, [...ids], null);
          if (!r.conns.size) scheduleUnload(docId, r);
        },
      };
    },
    doc: (docId) => rooms.get(docId)?.doc,
    async flush() {
      await Promise.all([...rooms].map(([id, r]) => store(id, r)));
      await Promise.all(lastStore.values());
    },
  };
}

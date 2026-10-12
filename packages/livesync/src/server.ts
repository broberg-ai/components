// @broberg/livesync/server — F100.1. One room per document; every
// connection's changes are merged into the room's copy and sent on to the
// others. Transport-agnostic: anything that can send bytes and be closed is
// a connection (a Bun/Hono WebSocket, or an in-memory pair in a test). The
// HTTP upgrade, auth (F100.2) and persistence (F100.3) sit on top of this.
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
}

export interface Livesync {
  /** Attach a connection to the document `docId`; the server opens with sync step 1. */
  connect(docId: string, conn: Connection): ConnectionHandle;
  /** The room's current copy — what every connection converges to. undefined when no one is connected. */
  doc(docId: string): Y.Doc | undefined;
}

export function createLivesync(options: LivesyncOptions = {}): Livesync {
  if (!options.authorize && !options.insecureNoAuth) {
    throw new Error("livesync: pass `authorize` (the login check) — or `insecureNoAuth: true` for a test; an unauthenticated server is never the default");
  }
  const authorize = options.authorize;
  const rooms = new Map<string, Room>();

  function room(docId: string): Room {
    let r = rooms.get(docId);
    if (r) return r;
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // the server is not a participant
    const fresh: Room = { doc, awareness, conns: new Map() };
    // Every change to the room's copy goes to everyone except the connection it came from.
    doc.on("update", (update: Uint8Array, origin: unknown) => {
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
    rooms.set(docId, fresh);
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

      const join = () => {
        r = room(docId);
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

      if (!authorize) join();

      return {
        message(data) {
          if (dead) return;
          if (joined) return handle(data);
          if (!authStarted) {
            // The first message must be the login.
            let token: string | null = null;
            try {
              token = messageType(data) === MESSAGE_AUTH ? readAuth(data) : null;
            } catch {
              token = null;
            }
            if (token === null) return refuse();
            authStarted = true;
            authorize!(token, docId).then(
              (p) => {
                if (dead) return;
                if (!p) return refuse();
                principal = p;
                join();
              },
              () => refuse(), // a login check that throws is a refusal, never an open door
            );
            return;
          }
          pending.push(data.slice()); // sync step 1 etc. arriving while the check runs
        },
        closed() {
          dead = true;
          if (!r) return;
          const ids = r.conns.get(conn);
          r.conns.delete(conn);
          if (ids?.size) awarenessProtocol.removeAwarenessStates(r.awareness, [...ids], null);
          // The room stays when the last editor leaves: with no persistence yet
          // (F100.3), unloading it would throw the document away. F100.3 stores
          // it first and only then unloads idle rooms.
        },
      };
    },
    doc: (docId) => rooms.get(docId)?.doc,
  };
}

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
import { encodeAwareness, encodeSyncStep1, encodeUpdate, handleMessage } from "./protocol";

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

export interface Livesync {
  /** Attach a connection to the document `docId`; the server opens with sync step 1. */
  connect(docId: string, conn: Connection): ConnectionHandle;
  /** The room's current copy — what every connection converges to. undefined when no one is connected. */
  doc(docId: string): Y.Doc | undefined;
}

export function createLivesync(): Livesync {
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
      const r = room(docId);
      r.conns.set(conn, new Set());
      safeSend(conn, encodeSyncStep1(r.doc));
      const states = [...r.awareness.getStates().keys()];
      if (states.length) safeSend(conn, encodeAwareness(r.awareness, states));
      return {
        message(data) {
          const { reply } = handleMessage(data, r.doc, r.awareness, conn);
          if (reply) safeSend(conn, reply);
        },
        closed() {
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

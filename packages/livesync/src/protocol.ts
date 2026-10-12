// @broberg/livesync — F100.1. The wire format both halves speak: the standard
// Yjs sync + awareness messages, framed exactly as y-websocket frames them
// ([varuint type][payload]) so an existing Yjs editor binding works unchanged.
//
//  0 SYNC       step 1 (my state vector) / step 2 (what you lack) / update
//  1 AWARENESS  presence: who is here, cursors (F100.4 draws it)
//  2 AUTH       F100.2 — the client's FIRST message: its login token. Sent in
//               the socket, not the URL, so it never lands in an access log.
//  3 DENIED     F100.2 — the server's only answer to a refused login, then close.
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import type * as Y from "yjs";

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_AUTH = 2;
export const MESSAGE_DENIED = 3;

export function encodeAuth(token: string): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_AUTH);
  encoding.writeVarString(e, token);
  return encoding.toUint8Array(e);
}
export function encodeDenied(): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_DENIED);
  return encoding.toUint8Array(e);
}
/** The message type, without consuming anything. */
export function messageType(data: Uint8Array): number {
  return decoding.readVarUint(decoding.createDecoder(data));
}
/** The token in an AUTH message; null when it is not one. */
export function readAuth(data: Uint8Array): string | null {
  const d = decoding.createDecoder(data);
  return decoding.readVarUint(d) === MESSAGE_AUTH ? decoding.readVarString(d) : null;
}
/** Is this a sync message that would CHANGE the document (step 2 or update)? Read-only users may not send those. */
export function isWrite(data: Uint8Array): boolean {
  const d = decoding.createDecoder(data);
  if (decoding.readVarUint(d) !== MESSAGE_SYNC) return false;
  const kind = decoding.readVarUint(d);
  return kind === syncProtocol.messageYjsSyncStep2 || kind === syncProtocol.messageYjsUpdate;
}

/** Step 1: "here is what I have" — the other side answers with what I lack. */
export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(e, doc);
  return encoding.toUint8Array(e);
}

/** One document update, framed for the wire. */
export function encodeUpdate(update: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_SYNC);
  syncProtocol.writeUpdate(e, update);
  return encoding.toUint8Array(e);
}

export function encodeAwareness(awareness: awarenessProtocol.Awareness, clients: number[]): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(awareness, clients));
  return encoding.toUint8Array(e);
}

export interface Handled {
  /** The bytes to send back (sync step 2), or null when nothing is owed. */
  reply: Uint8Array | null;
  /** The message was sync step 2 — the sender is now caught up with us. */
  wasStep2: boolean;
}

/**
 * Apply one incoming message to `doc` / `awareness`. `origin` is recorded on
 * the Yjs transaction so the caller can tell its own echo from a real change.
 */
export function handleMessage(data: Uint8Array, doc: Y.Doc, awareness: awarenessProtocol.Awareness, origin: unknown): Handled {
  const d = decoding.createDecoder(data);
  const type = decoding.readVarUint(d);
  if (type === MESSAGE_SYNC) {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_SYNC);
    const kind = syncProtocol.readSyncMessage(d, e, doc, origin);
    return { reply: encoding.length(e) > 1 ? encoding.toUint8Array(e) : null, wasStep2: kind === syncProtocol.messageYjsSyncStep2 };
  }
  if (type === MESSAGE_AWARENESS) {
    awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(d), origin);
    return { reply: null, wasStep2: false };
  }
  throw new Error(`livesync: unknown message type ${type}`);
}

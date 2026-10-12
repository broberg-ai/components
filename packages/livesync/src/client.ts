// @broberg/livesync/client — F100.1. Keeps a Y.Doc in step with the app's
// sync server over a WebSocket, and keeps working when the network does not.
//
//  - Offline is normal (owner 12/10: «ja offline»): edits made while
//    disconnected stay in the local doc; on reconnect both sides exchange
//    state vectors (sync step 1/2) and each sends exactly what the other lacks,
//    so nobody's edits are lost and nothing is applied twice. Surviving a
//    closed tab (IndexedDB) is F100.3.
//  - Reconnects with backoff (500 ms doubling to 10 s), forever, until destroy().
//  - state: "connecting" → "synced" (the server's step 2 arrived) → "offline".
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { encodeAuth, encodeAwareness, encodeSyncStep1, encodeUpdate, handleMessage, messageType, MESSAGE_DENIED } from "./protocol";

/** "denied": the server refused the login — no automatic retry until reconnect() (with a fresh token). */
export type SyncState = "connecting" | "synced" | "offline" | "denied";

/** The slice of the WebSocket API this uses — the browser's, Bun's, or a test's. */
export interface SocketLike {
  binaryType: string;
  readyState: number;
  send(data: Uint8Array): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

export interface ConnectOptions {
  /** The sync endpoint for ONE document, e.g. wss://app.example/sync/<docId>. */
  url: string;
  /** Bring your own doc (e.g. one restored from IndexedDB); default a fresh Y.Doc. */
  doc?: Y.Doc;
  /** Default: the global WebSocket. */
  socket?: SocketFactory;
  /**
   * F100.2 — the login token, asked for on EVERY (re)connect, so a refreshed
   * BID session is picked up without the app doing anything. Sent as the
   * first message on the socket, never in the URL.
   */
  getToken?: () => Promise<string>;
  /** Backoff bounds, ms. Default 500 → 10 000. */
  minDelayMs?: number;
  maxDelayMs?: number;
}

export interface LiveDoc {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  readonly state: SyncState;
  /** Subscribe to state changes; returns an unsubscribe. */
  onState(fn: (s: SyncState) => void): () => void;
  /** Drop the connection on purpose (go offline) — edits keep working locally. */
  disconnect(): void;
  /** Connect again after disconnect(). */
  reconnect(): void;
  destroy(): void;
}

const OPEN = 1;

export function connect(o: ConnectOptions): LiveDoc {
  const doc = o.doc ?? new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const factory: SocketFactory = o.socket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
  const minDelay = o.minDelayMs ?? 500;
  const maxDelay = o.maxDelayMs ?? 10_000;
  const listeners = new Set<(s: SyncState) => void>();
  let state: SyncState = "connecting";
  let ws: SocketLike | null = null;
  let wanted = true;
  let delay = minDelay;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const setState = (s: SyncState) => {
    if (s === state) return;
    state = s;
    for (const fn of listeners) fn(s);
  };
  const send = (msg: Uint8Array) => {
    if (ws && ws.readyState === OPEN) ws.send(msg);
  };

  // Local edits go out while connected. While offline they simply stay in the
  // doc; step 1/2 on reconnect carries them.
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== self) send(encodeUpdate(update));
  };
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== self) send(encodeAwareness(awareness, [...added, ...updated, ...removed]));
  };
  doc.on("update", onUpdate);
  awareness.on("update", onAwareness);

  const self = {}; // the origin for changes that came FROM the server — never echoed back

  function open(): void {
    if (!wanted) return;
    setState("connecting");
    const s = factory(o.url);
    s.binaryType = "arraybuffer";
    ws = s;
    s.onopen = async () => {
      delay = minDelay;
      if (o.getToken) {
        let token: string;
        try {
          token = await o.getToken();
        } catch {
          s.close(); // no token right now — offline, and retried with backoff
          return;
        }
        send(encodeAuth(token));
      }
      send(encodeSyncStep1(doc));
      if (awareness.getLocalState() !== null) send(encodeAwareness(awareness, [doc.clientID]));
    };
    s.onmessage = (ev) => {
      const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : (ev.data as Uint8Array);
      if (messageType(data) === MESSAGE_DENIED) {
        // A refused login does not get better by retrying the same token every few seconds.
        wanted = false;
        setState("denied");
        return;
      }
      const { reply, wasStep2 } = handleMessage(data, doc, awareness, self);
      if (reply) send(reply);
      if (wasStep2) setState("synced");
    };
    s.onclose = () => {
      if (ws === s) ws = null;
      if (state !== "denied") setState("offline");
      if (!wanted) return;
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, maxDelay);
    };
    s.onerror = () => s.close();
  }

  open();

  return {
    doc,
    awareness,
    get state() {
      return state;
    },
    onState(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    disconnect() {
      wanted = false;
      clearTimeout(timer);
      ws?.close();
      setState("offline");
    },
    reconnect() {
      if (wanted) return;
      wanted = true;
      delay = minDelay;
      open();
    },
    destroy() {
      wanted = false;
      clearTimeout(timer);
      ws?.close();
      doc.off("update", onUpdate);
      awareness.off("update", onAwareness);
      awareness.destroy();
    },
  };
}

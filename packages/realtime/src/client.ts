// F103.1 — @broberg/realtime/client: the browser half. No node: imports.
//
// «100% live» on a phone is mostly about what happens when it is NOT live: iOS closes
// an EventSource when a PWA goes to the background, and a stream can die without an
// error event behind a proxy. So the client reopens on visible / online / silence,
// asks for what it missed (?lastEventId=), and never delivers the same id twice.

import { PING, type RealtimeEvent } from "./protocol.js";

export { PRESENCE, type RealtimeEvent } from "./protocol.js";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

interface EventSourceLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string; lastEventId?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  /** F103.4 — only used when `named` is set. */
  addEventListener?(type: string, fn: (ev: { data: string; lastEventId?: string }) => void): void;
  close(): void;
}

export interface ConnectOptions {
  onEvent: (e: RealtimeEvent) => void;
  onState?: (s: ConnectionState) => void;
  /** A stream with no event (pings included) for this long is treated as dead. Default 45000 (3 missed 15 s pings). */
  staleMs?: number;
  /** Injected for tests. Default: globalThis.EventSource. */
  EventSource?: new (url: string, init?: { withCredentials?: boolean }) => EventSourceLike;
  /** Injected for tests. Default: globalThis (window) and document. */
  win?: Pick<Window, "addEventListener" | "removeEventListener">;
  doc?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  now?: () => number;
  withCredentials?: boolean;
  /**
   * F103.4 — the event types to listen for when the server streams with
   * `named: true` (`event: <type>` frames). Each arrives at `onEvent` exactly like
   * a default frame. `$ping` keeps arriving as a default frame either way.
   */
  named?: string[];
}

export interface Connection {
  readonly lastEventId: string | null;
  close(): void;
}

const CLOSED = 2;

export function connect(url: string, opts: ConnectOptions): Connection {
  const ES = opts.EventSource ?? (globalThis as unknown as { EventSource: NonNullable<ConnectOptions["EventSource"]> }).EventSource;
  const win = opts.win ?? (globalThis as unknown as Window);
  const doc = opts.doc ?? (globalThis as unknown as { document: Document }).document;
  const now = opts.now ?? (() => Date.now());
  const staleMs = opts.staleMs ?? 45_000;

  let es: EventSourceLike | null = null;
  let lastEventId: string | null = null;
  let lastSeen = now();
  let closed = false;
  let backoff = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const seen: string[] = [];
  // id → the raw data it arrived with (F103.3): an id seen again with the SAME
  // data is a replay overlap; with OTHER data it is an id-less event that
  // inherited the id from the browser's last-event-id buffer.
  const seenData = new Map<string, string>();
  const setState = (s: ConnectionState) => opts.onState?.(s);

  const remember = (id: string, data: string): void => {
    seenData.set(id, data);
    seen.push(id);
    if (seen.length > 500) seenData.delete(seen.shift()!);
  };

  const open = (state: ConnectionState): void => {
    if (closed) return;
    es?.close();
    setState(state);
    const target = lastEventId ? `${url}${url.includes("?") ? "&" : "?"}lastEventId=${encodeURIComponent(lastEventId)}` : url;
    const source = new ES(target, { withCredentials: opts.withCredentials ?? true });
    es = source;
    lastSeen = now();
    source.onopen = () => {
      if (es !== source) return;
      backoff = 1000;
      lastSeen = now();
      setState("open");
    };
    const handle = (ev: { data: string; lastEventId?: string }, namedType?: string): void => {
      if (es !== source) return;
      lastSeen = now();
      let msg: { type: string; data?: unknown };
      try {
        msg = namedType ? { type: namedType, data: JSON.parse(ev.data) } : JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === PING) return;
      // F103.3 — the EventSource standard does NOT reset the last-event-id buffer
      // for an event without an `id:` line, so such an event arrives carrying the
      // PREVIOUS id (jam measured «typing» after a message being dropped). An id
      // we have seen is a duplicate only if the data is identical too.
      let id = ev.lastEventId || undefined;
      if (id && seenData.has(id)) {
        if (seenData.get(id) === ev.data) return; // a replay overlapping what we had
        id = undefined; // inherited: deliver it as the id-less event it is
      } else if (id) {
        lastEventId = id;
        remember(id, ev.data);
      }
      opts.onEvent(id ? { type: msg.type, data: msg.data, id } : { type: msg.type, data: msg.data });
    };
    source.onmessage = (ev) => handle(ev);
    for (const type of opts.named ?? []) source.addEventListener?.(type, (ev) => handle(ev, type));
    source.onerror = () => {
      if (es !== source) return;
      // CONNECTING: the browser is retrying by itself. CLOSED: it gave up (e.g. a 5xx) — we reopen with backoff.
      setState("reconnecting");
      if (source.readyState === CLOSED) scheduleReopen();
    };
  };

  const scheduleReopen = (): void => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open("reconnecting");
    }, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };

  const isStale = (): boolean => !es || es.readyState === CLOSED || now() - lastSeen > staleMs;
  const onVisible = (): void => {
    if (doc.visibilityState === "visible" && isStale()) open("reconnecting");
  };
  const onOnline = (): void => {
    if (isStale()) open("reconnecting");
  };
  // A stream can die with no error event at all (a proxy holding a dead TCP). The pings make that visible.
  const watchdog = setInterval(() => {
    if (!closed && now() - lastSeen > staleMs) open("reconnecting");
  }, Math.max(1000, Math.floor(staleMs / 3)));

  doc.addEventListener("visibilitychange", onVisible);
  win.addEventListener("online", onOnline);
  open("connecting");

  return {
    get lastEventId() {
      return lastEventId;
    },
    close() {
      closed = true;
      clearInterval(watchdog);
      if (retryTimer) clearTimeout(retryTimer);
      doc.removeEventListener("visibilitychange", onVisible);
      win.removeEventListener("online", onOnline);
      es?.close();
      setState("closed");
    },
  };
}

export interface OutboxItem<T> {
  clientId: string;
  payload: T;
  /** pending: on its way · sent: the server accepted it, its echo has not arrived · failed: the POST failed — retry() it. */
  state: "pending" | "sent" | "failed";
  error?: string;
}

/**
 * Optimistic sending. send() shows the message AT ONCE (pending) with a clientId; put
 * that clientId in the event your server publishes, and call reconcile(clientId) when
 * it arrives — the optimistic copy is removed in the same moment you render the real
 * one, so it is never shown twice and never missing.
 */
export function createOutbox<T>(opts: {
  post: (item: { clientId: string; payload: T }) => Promise<void>;
  onChange: (items: OutboxItem<T>[]) => void;
  newId?: () => string;
}) {
  const items = new Map<string, OutboxItem<T>>();
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const emit = () => opts.onChange([...items.values()].map((i) => ({ ...i })));
  const attempt = (clientId: string): void => {
    const it = items.get(clientId);
    if (!it) return;
    opts.post({ clientId, payload: it.payload }).then(
      () => {
        const cur = items.get(clientId);
        if (!cur) return; // already reconciled — the echo beat the POST's answer
        cur.state = "sent";
        delete cur.error;
        emit();
      },
      (e: unknown) => {
        const cur = items.get(clientId);
        if (!cur) return;
        cur.state = "failed";
        cur.error = e instanceof Error ? e.message : String(e);
        emit();
      },
    );
  };
  return {
    send(payload: T): OutboxItem<T> {
      const item: OutboxItem<T> = { clientId: newId(), payload, state: "pending" };
      items.set(item.clientId, item);
      emit();
      attempt(item.clientId);
      return { ...item };
    },
    retry(clientId: string): void {
      const it = items.get(clientId);
      if (!it || it.state !== "failed") return;
      it.state = "pending";
      delete it.error;
      emit();
      attempt(clientId);
    },
    /** The server's echo arrived. Returns true if it was one of ours. */
    reconcile(clientId: string | undefined | null): boolean {
      if (!clientId || !items.delete(clientId)) return false;
      emit();
      return true;
    },
    get items(): OutboxItem<T>[] {
      return [...items.values()].map((i) => ({ ...i }));
    },
  };
}

/** «Skriver …» at most once per interval while typing, and one stop when it ends. */
export function typingThrottle(send: (active: boolean) => void, opts: { intervalMs?: number; now?: () => number } = {}) {
  const interval = opts.intervalMs ?? 3000;
  const now = opts.now ?? (() => Date.now());
  let last = -Infinity;
  let active = false;
  return {
    typing(): void {
      if (now() - last >= interval) {
        last = now();
        active = true;
        send(true);
      }
    },
    stop(): void {
      if (!active) return;
      active = false;
      last = -Infinity;
      send(false);
    },
  };
}

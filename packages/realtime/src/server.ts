// F103.1 — @broberg/realtime/server: live channels over SSE.
//
// Harvested from xrt81 F074 (chatBus.ts + the /:channel/stream route, commit 718575d):
// fan-out per channel, resume before live, a heartbeat through proxies, and a listener
// that is ALWAYS removed when the stream closes. Its documented limit — «fan-out happens
// in the PROCESS; with two machines one machine's listeners never see the other's
// messages» — is what the bus below removes.
//
// Web-standard Response/ReadableStream only: Hono, Bun, Node 18+, Next route handlers.

import { PING, PRESENCE, RealtimeError, type RealtimeEvent } from "./protocol.js";

export { RealtimeError, PRESENCE, type RealtimeEvent } from "./protocol.js";

interface BusMessage {
  channel: string;
  event: RealtimeEvent;
}

/** Carries every publish to every hub — including the one that published. */
export interface RealtimeBus {
  publish(msg: BusMessage): Promise<void>;
  subscribe(handler: (msg: BusMessage) => void): () => void;
}

/** One process, one machine. The default. */
export function memoryBus(): RealtimeBus {
  const handlers = new Set<(msg: BusMessage) => void>();
  return {
    async publish(msg) {
      for (const h of handlers) {
        try {
          h(msg);
        } catch {
          // One failing hub must not stop the others from receiving the event.
        }
      }
    },
    subscribe(h) {
      handlers.add(h);
      return () => handlers.delete(h);
    },
  };
}

/** The two postgres.js functions the bus needs (`sql.listen`, `sql.notify`) — e.g. @broberg/db-sdk's `client.raw`. */
export interface PostgresListenNotify {
  listen(channel: string, onNotify: (payload: string) => void): Promise<unknown>;
  notify(channel: string, payload: string): Promise<unknown>;
}

/** Postgres NOTIFY refuses payloads of 8000 bytes or more. */
export const NOTIFY_MAX_BYTES = 7999;

/**
 * Several machines, one Postgres: every hub LISTENs on one Postgres channel and
 * every publish is a NOTIFY. A payload over the NOTIFY limit is refused with a
 * named error BEFORE it is sent — publish the message's id, not the message.
 */
export function postgresBus(
  sql: PostgresListenNotify,
  opts: {
    pgChannel?: string;
    /** A LISTEN that failed (e.g. Postgres down at boot). The hub then receives nothing until the next subscribe retries. Default: console.error. */
    onError?: (err: unknown) => void;
  } = {},
): RealtimeBus {
  const pgChannel = opts.pgChannel ?? "broberg_realtime";
  const onError = opts.onError ?? ((err: unknown) => console.error(`[@broberg/realtime] LISTEN ${pgChannel} failed — this hub receives no events`, err));
  const handlers = new Set<(msg: BusMessage) => void>();
  let listening: Promise<unknown> | null = null;
  return {
    async publish(msg) {
      const payload = JSON.stringify(msg);
      const bytes = new TextEncoder().encode(payload).length;
      if (bytes > NOTIFY_MAX_BYTES) {
        throw new RealtimeError(
          "payload_too_large",
          `event "${msg.event.type}" on "${msg.channel}" is ${bytes} bytes; Postgres NOTIFY carries at most ${NOTIFY_MAX_BYTES}. Publish the id and let clients fetch the body.`,
        );
      }
      await sql.notify(pgChannel, payload);
    },
    subscribe(h) {
      handlers.add(h);
      listening ??= sql.listen(pgChannel, (payload) => {
        let msg: BusMessage;
        try {
          msg = JSON.parse(payload) as BusMessage;
        } catch {
          return; // not ours
        }
        for (const fn of handlers) {
          try {
            fn(msg);
          } catch {
            /* one hub's failure is not another's */
          }
        }
      }).catch((err: unknown) => {
        // Unhandled, this rejection crashes Node — and before that, the hub is deaf with no sign of it.
        listening = null;
        onError(err);
      });
      return () => handlers.delete(h);
    },
  };
}

export interface PresenceMember {
  id: string;
  [k: string]: unknown;
}

export interface RealtimeOptions {
  bus?: RealtimeBus;
  /** Durable events after `lastEventId`, oldest first — read from YOUR store. Without it there is no resume. */
  replay?: (channel: string, lastEventId: string) => Promise<RealtimeEvent[]>;
  /** A ping every this many ms keeps proxies from closing a quiet stream and lets the client notice a dead one. Default 15000. */
  heartbeatMs?: number;
  /** The `retry:` hint for the browser's own reconnect. Default 1000. */
  retryMs?: number;
  /** A member not touched for this long has left. Default 30000. */
  presenceTtlMs?: number;
}

/** F103.4 — per-subscriber options for one stream. Without them a stream is byte-identical to 0.1.x. */
export interface StreamOptions {
  lastEventId?: string | null;
  signal?: AbortSignal;
  /**
   * Called for EVERY host event this subscriber would receive — live AND replayed —
   * before it is written. Return the event to send (changed or not) or `null` to
   * skip it. Use it to give each subscriber their own view of one channel (a
   * visitor sees only visible messages; staff see everything). `$ping` and
   * `presence` never pass through it, so a filter cannot silence the heartbeat.
   * It may return a Promise (F103.6). Delivery is then QUEUED per stream, so the
   * order is kept: a slow event holds back the ones after it, live and replayed.
   * A rejected promise is treated like a throw.
   *
   * A transform that throws — or returns a type/id publish() would refuse (a newline,
   * a `$` type) — skips the event (fail closed: a broken filter must not leak what it
   * was meant to hide, nor write SSE lines of its own).
   *
   * A skipped DURABLE event is still written as a bare `id:` line, which moves the
   * browser's Last-Event-ID past it without dispatching anything — so a resume does
   * not restart from before it.
   */
  transform?: (event: RealtimeEvent) => RealtimeEvent | null | Promise<RealtimeEvent | null>;
  /**
   * Write SSE named events — `event: <type>` + `data: <JSON of data>` — instead of
   * the default single `data: {"type":…,"data":…}` line. For clients that listen
   * with `addEventListener(type)`; @broberg/realtime/client reads them with
   * `connect(url, { named: [...] })`. `$ping` stays a default (unnamed) frame.
   */
  named?: boolean;
  /**
   * F103.6 — frames written FIRST on this connection, before any replay or live
   * event: a per-connection hello (`ready` with a token exchanged at connect,
   * for instance). Written without an `id:` line, so they never move the
   * browser's Last-Event-ID, and NOT passed through `transform` — they are the
   * connection's own, not the channel's. Checked like a published event (no
   * newline in type, no `$` type).
   */
  initial?: RealtimeEvent[];
  /**
   * F103.6 — how the keep-alive is written. `"event"` (default, as before) is a
   * `$ping` data frame that @broberg/realtime/client uses as its sign of life.
   * `"comment"` writes an SSE comment (`: ping`) that no EventSource dispatches —
   * for EXTERNAL clients that would otherwise see an event they do not know.
   * @broberg/realtime/client cannot see a comment, so with `"comment"` its
   * silence watchdog reopens a stream that only carries heartbeats; use
   * `"event"` with our own client.
   */
  heartbeat?: "event" | "comment";
}

export interface Realtime {
  /** With `event.id` the event is durable; without, ephemeral. Goes through the bus, also locally — one path, never twice. */
  publish(channel: string, event: RealtimeEvent): Promise<void>;
  /** The SSE response for one subscriber. Pass the request's Last-Event-ID (see lastEventIdFrom) and its abort signal. */
  stream(channel: string, opts?: StreamOptions): Response;
  presence: {
    /** «I am here». Emits `presence {action:"join"}` the first time; afterwards only refreshes the expiry. */
    touch(channel: string, member: PresenceMember): Promise<void>;
    leave(channel: string, memberId: string): Promise<void>;
    list(channel: string): PresenceMember[];
  };
  /** Open streams on a channel (or all). For tests and health checks. */
  listenerCount(channel?: string): number;
  /** Stop timers and leave the bus. */
  close(): void;
}

/** Last-Event-ID from the header (the browser's own reconnect) or ?lastEventId= (the client's reopen). */
export function lastEventIdFrom(req: Request): string | null {
  return req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("lastEventId");
}

const PRESENCE_INTERNAL = "$presence";

function checkEvent(e: RealtimeEvent): void {
  if (typeof e.type !== "string" || !e.type || /[\r\n]/.test(e.type)) throw new RealtimeError("invalid_event", "event.type must be a non-empty single-line string");
  if (e.type.startsWith("$")) throw new RealtimeError("reserved_type", `event types starting with "$" are the package's own ("${e.type}")`);
  if (e.id !== undefined && (typeof e.id !== "string" || !e.id || /[\r\n]/.test(e.id))) throw new RealtimeError("invalid_event", "event.id must be a non-empty single-line string");
}

export function createRealtime(opts: RealtimeOptions = {}): Realtime {
  const bus = opts.bus ?? memoryBus();
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const retryMs = opts.retryMs ?? 1000;
  const ttl = opts.presenceTtlMs ?? 30_000;

  const listeners = new Map<string, Set<(e: RealtimeEvent) => void>>();
  const members = new Map<string, Map<string, { member: PresenceMember; timer: ReturnType<typeof setTimeout> }>>();

  const deliver = (channel: string, e: RealtimeEvent): void => {
    for (const fn of listeners.get(channel) ?? []) {
      try {
        fn(e);
      } catch {
        /* a broken stream must not stop the others */
      }
    }
  };

  // Presence is derived on EVERY hub from the bus, so each hub's streams see join/leave
  // even when the member touched another machine. Expiry is a local timer per hub.
  const expire = (channel: string, id: string): void => {
    const m = members.get(channel);
    const entry = m?.get(id);
    if (!m || !entry) return;
    clearTimeout(entry.timer);
    m.delete(id);
    if (m.size === 0) members.delete(channel);
    deliver(channel, { type: PRESENCE, data: { action: "leave", member: entry.member } });
  };
  const onPresence = (channel: string, data: { action: "here" | "leave"; member: PresenceMember }): void => {
    if (data.action === "leave") return expire(channel, data.member.id);
    let m = members.get(channel);
    if (!m) members.set(channel, (m = new Map()));
    const existing = m.get(data.member.id);
    if (existing) clearTimeout(existing.timer);
    m.set(data.member.id, { member: data.member, timer: setTimeout(() => expire(channel, data.member.id), ttl) });
    if (!existing) deliver(channel, { type: PRESENCE, data: { action: "join", member: data.member } });
  };

  const unsubscribeBus = bus.subscribe(({ channel, event }) => {
    if (event.type === PRESENCE_INTERNAL) onPresence(channel, event.data as Parameters<typeof onPresence>[1]);
    else deliver(channel, event);
  });

  const addListener = (channel: string, fn: (e: RealtimeEvent) => void): (() => void) => {
    let set = listeners.get(channel);
    if (!set) listeners.set(channel, (set = new Set()));
    set.add(fn);
    return () => {
      const s = listeners.get(channel);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) listeners.delete(channel);
    };
  };

  return {
    async publish(channel, event) {
      checkEvent(event);
      await bus.publish({ channel, event });
    },

    stream(channel, { lastEventId = null, signal, transform, named = false, initial = [], heartbeat = "event" } = {}) {
      // Checked HERE, so a bad hello throws at the caller rather than inside the stream.
      for (const e of initial) checkEvent(e);
      const enc = new TextEncoder();
      let cleanup = (): void => {};
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false;
          const write = (s: string): void => {
            if (closed) return;
            try {
              controller.enqueue(enc.encode(s));
            } catch {
              cleanup();
            }
          };
          // One JSON line per event: the client uses onmessage for all of them, and a
          // `$ping` it can SEE (a comment would be invisible) tells it the stream is alive.
          const frame = (e: RealtimeEvent): string => `${e.id ? `id: ${e.id}\n` : ""}data: ${JSON.stringify({ type: e.type, data: e.data })}\n\n`;
          // F103.4 — `event:` + the bare data, for clients that listen by name.
          const namedFrame = (e: RealtimeEvent): string =>
            `${e.id ? `id: ${e.id}\n` : ""}event: ${e.type}\ndata: ${JSON.stringify(e.data ?? null)}\n\n`;
          const hostFrame = named ? namedFrame : frame;

          let replaying = true;
          const buffered: RealtimeEvent[] = [];
          const replayedIds = new Set<string>();
          const deliver = async (e: RealtimeEvent): Promise<void> => {
            if (!transform || e.type === PRESENCE) return write(hostFrame(e));
            let out: RealtimeEvent | null;
            try {
              const t = await transform(e);
              out = t && (t.id || !e.id ? t : { ...t, id: e.id });
              // The same rules publish() enforces: a newline in type or id would let a
              // transform write SSE lines of its own (a forged event:/data:/id:).
              if (out) checkEvent(out);
            } catch {
              out = null;
            }
            if (out) return write(hostFrame(out));
            if (e.id) write(`id: ${e.id}\n\n`);
          };
          // F103.6 — with a transform, every event goes through ONE queue so an async
          // transform cannot reorder them (presence too, or it would overtake). Without
          // one, writes stay synchronous: byte-for-byte and tick-for-tick 0.2.3.
          let queue: Promise<void> = Promise.resolve();
          const send = (e: RealtimeEvent): void => {
            if (!transform) return void deliver(e);
            queue = queue.then(() => deliver(e));
          };
          const removeListener = addListener(channel, (e) => (replaying ? buffered.push(e) : send(e)));
          const beat = setInterval(() => write(heartbeat === "comment" ? ": ping\n\n" : frame({ type: PING })), heartbeatMs);
          cleanup = () => {
            if (closed) return;
            closed = true;
            clearInterval(beat);
            removeListener();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          };
          signal?.addEventListener("abort", () => cleanup(), { once: true });
          if (signal?.aborted) return cleanup();

          write(`retry: ${retryMs}\n\n`);
          // F103.6 — the connection's own first frames: before replay, no id, no transform.
          for (const e of initial) write(hostFrame({ type: e.type, data: e.data }));
          // Subscribed FIRST, replayed SECOND, buffer flushed THIRD — so an event published
          // while the replay runs is neither lost nor sent twice.
          void (async () => {
            if (lastEventId && opts.replay) {
              try {
                for (const e of await opts.replay(channel, lastEventId)) {
                  send(e);
                  if (e.id) replayedIds.add(e.id);
                }
              } catch {
                // A failed replay must not keep the live stream from starting.
              }
            }
            replaying = false;
            for (const e of buffered.splice(0)) if (!(e.id && replayedIds.has(e.id))) send(e);
            replayedIds.clear();
          })();
        },
        cancel() {
          cleanup();
        },
      });
      return new Response(body, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      });
    },

    presence: {
      async touch(channel, member) {
        await bus.publish({ channel, event: { type: PRESENCE_INTERNAL, data: { action: "here", member } } });
      },
      async leave(channel, memberId) {
        await bus.publish({ channel, event: { type: PRESENCE_INTERNAL, data: { action: "leave", member: { id: memberId } } } });
      },
      list(channel) {
        return [...(members.get(channel)?.values() ?? [])].map((e) => e.member);
      },
    },

    listenerCount(channel) {
      if (channel) return listeners.get(channel)?.size ?? 0;
      let n = 0;
      for (const s of listeners.values()) n += s.size;
      return n;
    },

    close() {
      unsubscribeBus();
      for (const m of members.values()) for (const e of m.values()) clearTimeout(e.timer);
      members.clear();
    },
  };
}

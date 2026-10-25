# @broberg/realtime

Live channels for chat and anything else that should feel instant: one SSE stream per channel, resume after a disconnect with no gap and no duplicate, «typing …» and presence, fan-out across several machines, and a browser client that keeps itself alive on a phone. Epic F103.

```bash
npm i @broberg/realtime
```

Why SSE, not WebSocket: only server → client needs an open stream; sending is a normal POST. SSE is plain HTTP — through Fly's proxy and corporate networks with no setup — the browser reconnects by itself and sends `Last-Event-ID` by itself. For frequent two-way traffic (a shared canvas) see `@broberg/livesync`.

## Server — `@broberg/realtime/server`

Web-standard `Response`: Hono, Bun, Node 18+, Next route handlers.

```ts
import { createRealtime, postgresBus, lastEventIdFrom } from "@broberg/realtime/server";

const rt = createRealtime({
  bus: postgresBus(sql),            // several machines: postgres.js sql.listen/sql.notify (e.g. @broberg/db-sdk client.raw). Default: memoryBus() — one machine.
  replay: (channel, sinceId) => db.messagesAfter(channel, sinceId), // durable events you STORED, oldest first
});

// GET /jam/:id/stream — check access FIRST, then:
app.get("/jam/:id/stream", (c) => rt.stream(`jam:${c.req.param("id")}`, { lastEventId: lastEventIdFrom(c.req.raw), signal: c.req.raw.signal }));

// POST /jam/:id/messages — store, then publish with the stored id and the sender's clientId:
const msg = await db.insertMessage(...);
await rt.publish(`jam:${id}`, { type: "message", id: msg.id, data: { ...msg, clientId: body.clientId } });

// Ephemeral (no id → never replayed):
await rt.publish(`jam:${id}`, { type: "typing", data: { userId, active: true } });

// Presence: touch on every heartbeat from the client; join/leave reach every stream as `presence` events.
await rt.presence.touch(`jam:${id}`, { id: userId, name });
rt.presence.list(`jam:${id}`);
```

- **Durable vs ephemeral.** An event with `id` is durable: after a reconnect, `replay` sends what was missed, then the stream goes live — an event published while the replay runs arrives exactly once. Without `id` it is ephemeral (typing, presence) and is never replayed.
- **One path.** `publish` always goes through the bus, also on the machine that published, so no machine delivers its own event twice.
- **A failed LISTEN** (Postgres down at boot) is reported through `postgresBus(sql, { onError })` (default `console.error`) — that hub receives nothing until it subscribes again.
- **Postgres NOTIFY carries at most 7999 bytes.** A bigger event is refused (`RealtimeError` `payload_too_large`) before it is sent: publish the id, let clients fetch the body.
- **Heartbeat.** A `$ping` every 15 s keeps proxies from closing a quiet stream, and lets the client notice a dead one.
- **Access is yours.** The package does not know who may see a channel — check before `stream()` and before `publish()`.
- Event types starting with `$` are the package's own; a type or id with a newline is refused.

### Per-subscriber view and named events (0.2.1, F103.4)

0.2.0 was tagged but never published — its release gate ran on a commit with a stale internal pin. 0.2.1 is the same code.

**0.2.2 — use this, not 0.2.1, if you stream named events.** In 0.2.1 `connect({ named })` read an `event: message` frame twice (a browser fires it on `onmessage` AND on a `'message'` listener): the first read gave `type: undefined`, and the correct one was then dropped as a duplicate. 0.2.2 delivers it once, correctly. Default (unnamed) streams were never affected.

**0.2.3** — the event a `transform` returns is checked by the same rules as `publish()` (no newline in type or id, no `$` type). Before, a transform deriving a type or id from user data could write SSE lines of its own; now such an event is skipped, fail closed, like a throwing transform.

One channel, a different view per subscriber — no channel per audience:

```ts
// the visitor's stream: only visible messages, without the staff-only note
rt.stream(`ticket:${id}`, {
  lastEventId: lastEventIdFrom(req),
  signal: req.signal,
  transform: (e) => (e.type === "message" && !e.data.visible ? null : e.type === "message" ? { ...e, data: { body: e.data.body } } : e),
});
// the console's stream on the same channel: everything
rt.stream(`ticket:${id}`, { lastEventId: lastEventIdFrom(req), signal: req.signal });
```

- `transform` runs for **live and replayed** events — a resume never leaks what the live path hides. `$ping` and `presence` never pass through it, so a filter cannot silence the heartbeat. A transform that throws skips the event (fail closed).
- A skipped **durable** event is still written as a bare `id:` line, so the browser's Last-Event-ID moves past it and a resume does not restart before it.
- `named: true` writes `event: <type>` + `data: <JSON of data>` (+ `id:`) for clients that use `addEventListener(type)`. Read them with `connect(url, { named: ["message", "state", "typing"], onEvent })`. `$ping` stays a default frame.

Without these options a stream is byte-identical to 0.1.x.

## Client — `@broberg/realtime/client`

No `node:` imports.

```ts
import { connect, createOutbox, typingThrottle } from "@broberg/realtime/client";

const conn = connect(`/jam/${id}/stream`, {
  onEvent: (e) => {
    if (e.type === "message") { outbox.reconcile(e.data.clientId); render(e.data); }
    if (e.type === "typing") showTyping(e.data);
    if (e.type === "presence") updatePresence(e.data); // { action: "join" | "leave", member }
  },
  onState: (s) => setBanner(s), // "connecting" | "open" | "reconnecting" | "closed"
});

const outbox = createOutbox({
  post: ({ clientId, payload }) => fetch(`/jam/${id}/messages`, { method: "POST", body: JSON.stringify({ clientId, ...payload }) }).then((r) => { if (!r.ok) throw new Error(String(r.status)); }),
  onChange: (pending) => renderPending(pending), // pending | sent | failed — failed has retry(clientId)
});
outbox.send({ text: "hej" }); // shown AT ONCE

const typing = typingThrottle((active) => fetch(`/jam/${id}/typing`, { method: "POST", body: JSON.stringify({ active }) }));
input.oninput = () => typing.typing();
input.onblur = () => typing.stop();
```

- **Your own message shows at once** (`pending`), and when the server's echo arrives with the same `clientId`, `reconcile` removes the optimistic copy in the same moment you render the real one — never twice, never missing. If the echo beats the POST's answer, the item is not resurrected.
- **On a phone.** iOS closes the stream when a PWA goes to the background. The client reopens when the page becomes visible again, when the device comes back online, or when the stream has been silent for 45 s (three missed pings), and asks for what it missed (`?lastEventId=`). The same id is never delivered twice.
- `typingThrottle` sends «typing» at most once per 3 s and one stop when it ends.

## What was measured

In-process, publish → the event on a subscriber's stream: p95 well under 1 ms over 100 events (the test fails above 50 ms). Network time on a real phone is measured by the first consumer (jam, F103.2).

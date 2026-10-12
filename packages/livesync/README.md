# @broberg/livesync

Real-time collaborative editing for the fleet, on **Yjs**: several people (or devices) edit the same document at the same time, nobody overwrites anybody, and an editor who goes offline keeps working and merges when they are back. Epic F100.

> **0.0.1 on npm is an empty placeholder.** The first usable version is 0.1.0. This README describes the code in this repository.

**Owner decisions (12/10):** each app runs its **own** sync server on its own database — there is no shared fleet service — and **offline editing is on**.

## Server — `@broberg/livesync/server` (F100.1)

```ts
import { createLivesync } from "@broberg/livesync/server";
const lv = createLivesync();

// Bun / Hono WebSocket — one connection per document:
const h = lv.connect(docId, { send: (bytes) => ws.send(bytes), close: () => ws.close() });
ws.onmessage = (e) => h.message(new Uint8Array(e.data));
ws.onclose = () => h.closed();
```

One room per document id. Every editor's changes merge into the room's copy and go out to everyone else. The standard Yjs sync + awareness messages, framed like y-websocket, so existing Yjs editor bindings work unchanged. Login (F100.2), storage in your database (F100.3) and presence UI (F100.4) come next — until F100.3 the room lives in memory only.

## Client — `@broberg/livesync/client` (F100.1)

```ts
import { connect } from "@broberg/livesync/client";
const live = connect({ url: `wss://your.app/sync/${docId}` });
live.doc.getMap("mindmap").set("title", "Idé");     // a normal Y.Doc
live.onState((s) => …);                             // "connecting" | "synced" | "offline"
```

- **Offline is normal:** edits made while disconnected stay in the doc; on reconnect each side sends exactly what the other lacks — nothing lost, nothing applied twice.
- **Reconnects by itself** with backoff (500 ms doubling to 10 s). `disconnect()` / `reconnect()` for a deliberate offline mode; `destroy()` to stop.

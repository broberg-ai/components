# @broberg/livesync

Real-time collaborative editing for the fleet, on **Yjs**: several people (or devices) edit the same document at the same time, nobody overwrites anybody, and an editor who goes offline keeps working and merges when they are back. Epic F100.

> **0.0.1 on npm is an empty placeholder.** The first usable version is 0.1.0. This README describes the code in this repository.

**Owner decisions (12/10):** each app runs its **own** sync server on its own database — there is no shared fleet service — and **offline editing is on**.

## Server — `@broberg/livesync/server` (F100.1)

```ts
import { createLivesync } from "@broberg/livesync/server";
const lv = createLivesync({
  // F100.2 — the login check. Required: there is no unauthenticated default.
  async authorize(token, docId) {
    const who = await tickets.verify(token, { scope: "jam:edit" });      // @broberg/sso — a BID user ticket
    if (who.type !== "user") return null;
    const role = await myApp.roleFor(who.principal, docId);             // your own "may this user open this document"
    return role ? { sub: who.principal, access: role === "viewer" ? "read" : "write" } : null;
  },
});

// Bun / Hono WebSocket — one connection per document:
const h = lv.connect(docId, { send: (bytes) => ws.send(bytes), close: () => ws.close() });
ws.onmessage = (e) => h.message(new Uint8Array(e.data));
ws.onclose = () => h.closed();
```

**Login (F100.2):** the client's first message is its token (never in the URL, so never in an access log). Until your `authorize` answers, the connection receives nothing — not even what the document contains. Refused (or a check that throws) → one `DENIED` message, then close. `access: "read"` users receive every change; anything they would change is dropped on the server.

One room per document id. Every editor's changes merge into the room's copy and go out to everyone else. The standard Yjs sync + awareness messages, framed like y-websocket, so existing Yjs editor bindings work unchanged. Storage in your database (F100.3) and presence UI (F100.4) come next — until F100.3 the room lives in memory only.

## Client — `@broberg/livesync/client` (F100.1)

```ts
import { connect } from "@broberg/livesync/client";
const live = connect({ url: `wss://your.app/sync/${docId}`, getToken: () => auth.ticket() });
live.doc.getMap("mindmap").set("title", "Idé");     // a normal Y.Doc
live.onState((s) => …);                             // "connecting" | "synced" | "offline" | "denied"
```

- **Offline is normal:** edits made while disconnected stay in the doc; on reconnect each side sends exactly what the other lacks — nothing lost, nothing applied twice.
- **Reconnects by itself** with backoff (500 ms doubling to 10 s). `disconnect()` / `reconnect()` for a deliberate offline mode; `destroy()` to stop.
- **Login:** `getToken()` is asked on every (re)connect, so a refreshed session is used automatically. A refused login → state `"denied"` and no retry storm; call `reconnect()` once the user has logged in again.

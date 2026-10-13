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

**Login (F100.2):** the client's first message is its token (never in the URL, so never in an access log). Until your `authorize` answers, the connection receives nothing — not even what the document contains. Refused (or a check that throws) → one `DENIED` message, then close. `access: "read"` users receive every change; anything they would change is dropped on the server. **Access is decided when the connection opens:** a user logged out of BID keeps an already-open connection until it reconnects (the client reconnects on every network blip, and re-asks `getToken`). Close the socket yourself when you learn of a logout (e.g. from @broberg/sso's back-channel logout) to cut it at once.

One room per document id. Every editor's changes merge into the room's copy and go out to everyone else. The standard Yjs sync + awareness messages, framed like y-websocket, so existing Yjs editor bindings work unchanged. See it running: `examples/livesync` (`bun run examples/livesync/server.ts` → http://127.0.0.1:5202/?name=Anna&doc=demo in two windows, or `/duo?doc=demo` for two people side by side in one window). The page shows how long the other person's change took to arrive.

### Storage in your own database (F100.3)

```ts
const lv = createLivesync({
  authorize,
  persistence: {
    load: async (docId) => (await db.get("SELECT state FROM docs WHERE id = ?", docId))?.state ?? null,
    store: async (docId, state) => db.run("INSERT INTO docs (id, state) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state", docId, state),
  },
  storeDebounceMs: 2000,     // default — at most one store per 2 s while people edit
  unloadAfterIdleMs: 60_000, // default — a room leaves memory a minute after the last editor, stored first
});
process.on("SIGTERM", async () => { await lv.flush(); process.exit(0); }); // a deploy must not lose the last 2 s
```

- `state` is the whole document as one Yjs update (bytes). Store it as a blob, replace it on every store.
- `load` is asked once when a room opens. If it **throws**, the connection is closed and nothing is sent — an empty document would be stored over the real one.
- If `store` throws, the room stays in memory and is retried; `onError(err, docId)` is told (default `console.error`).
- A read-only user's changes never reach the room, so they are never stored either.
- Without `persistence`, rooms live in memory only and are never unloaded.

## Client — `@broberg/livesync/client` (F100.1)

```ts
import { connect } from "@broberg/livesync/client";
const live = connect({ url: `wss://your.app/sync/${docId}`, getToken: () => auth.ticket() });
live.doc.getMap("mindmap").set("title", "Idé");     // a normal Y.Doc
live.onState((s) => …);                             // "connecting" | "synced" | "offline" | "denied"
```

- **Offline is normal:** edits made while disconnected stay in the doc; on reconnect each side sends exactly what the other lacks — nothing lost, nothing applied twice.
- **Reconnects by itself** with backoff (500 ms doubling to 10 s). `disconnect()` / `reconnect()` for a deliberate offline mode; `destroy()` to stop.
- **Survives a closed tab (F100.3):** ``connect({ …, offlineStore: `jam:${userId}:${docId}` })`` keeps the doc in IndexedDB; the next visit restores it (`await live.whenLoaded`) and sends what the server lacks. Name it per user **and** document — anyone using that browser profile can read it — and call `live.clearOfflineStore()` on logout.
- **Who is here (F100.4):** `live.presence.set({ user: { name, color } })` announces this tab; `live.presence.peers()` lists everyone ELSE (never yourself) with what they set; `live.presence.onChange(fn)` fires when someone arrives, moves or leaves. A cursor is just another field: `presence.set({ cursor: { x, y } })` (send `null` when the pointer leaves). A closed tab disappears from the others' list by itself.
- **Login:** `getToken()` is asked on every (re)connect, so a refreshed session is used automatically. A refused login → state `"denied"` and no retry storm; call `reconnect()` once the user has logged in again.

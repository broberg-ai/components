# F100 — @broberg/livesync: samtidig redigering for hele flåden

> Epic. Interim plan (open questions on top). Priority medium. Effort L. Status: backlog, waiting on consumer answers.

## Open Questions (blocking the build — answered by the consumers, not decided here)

1. **Who is first, and what do they edit?** jam asked (#2965 b) for "a Yjs/CRDT sync primitive" without saying what is edited (a shared transcript? notes on a clip? a live session doc?). cms has F71 v2 ("Google Docs-style", Yjs) parked as "Large, aspirational". The first consumer's document shape decides story F100.3. Asked jam 12/10.
2. **Text only, or structured documents?** Yjs carries both (Y.Text, Y.Map, Y.Array, Y.XmlFragment for rich text). A rich-text editor binding (TipTap/ProseMirror, CodeMirror) is a separate story per editor — which editor does the first consumer use?
3. **ANSWERED (Christian 12/10: «ja offline»): offline editing is in.** Edits are kept in the browser (IndexedDB) and merge on reconnect. Was: IndexedDB persistence on the client (y-indexeddb) makes edits survive a closed tab and merge later. Cheap to add, but it means data sits in the browser — does the first consumer want that?
4. **ANSWERED (Christian 12/10: «egen server pr. app»): one server per app**, each app's data in its own database; no fleet-wide sync service. Was: Recommendation: one package, each app runs its own server (its data stays in its own database). A single fleet-wide sync service would be one more thing that holds everyone's data. Owner call.

### jam's answers (#2989, 12/10)
- **(1)** The main shared document is **the mind map per Jam** (nodes, edges, types idea/question/decision/rejected/risk/source, a provenance link to a turn, collapsing) plus the Jam's title and notes. **Transcript turns are NEVER edited** (append-only, a change = a new branch) and do not go in Yjs. Possible 2nd client: cardmem, if Christian picks Yjs for Jam↔cardmem conflicts (his open question).
- **(2)** Mind map = structured data (Y.Map / Y.Array), rendered in React Flow (xyflow). Notes: editor not chosen; assume rich text, TipTap/ProseMirror most likely, not locked.
- **(3)** Offline edits to the mind map merged on reconnect — in jam's draft, not yet approved by Christian.
- **(4)** [Guessing, jam's own tag] 2–5 concurrent editors, rarely over 10. Cursors/awareness required. Stack awaits Christian (Next.js recommended) — **the client must work under React**.

Consequence for this plan: F100.1 targets Y.Map/Y.Array first (not text); the client ships a React hook beside the plain provider; question 3 stays open until Christian approves jam's draft; question 4 (one server per app) is unchanged.

## Summary
A shared npm package that lets several people (or devices) edit the same document at the same time and see each other's changes and cursors live, without anyone's work overwriting anyone else's. It gives every app the same building blocks — a sync server, a browser client, Broberg ID login and storage hooks — so jam, cms and others do not each build their own.

## Motivation
Christian 12/10: «Du må nok også se på at lave en fælles npm til livesync», and picked «samtidig redigering» over the existing Fly-Live site sync (already shared in @broberg/deploy-core) and the broberg-id database copy (infra, not a package).

The symptom today: every app that lets two people touch the same thing either has last-save-wins (silent data loss — cms F71's problem statement) or plans a lock. jam asked components directly for a CRDT primitive the same day. Without a shared package, the first app hand-rolls a WebSocket server with its own auth, the second copies it, and they drift — exactly the reuse rule's failure.

## Solution
Wrap **Yjs** (the de-facto CRDT library: conflict-free merge, awareness/presence, editor bindings) in a thin `@broberg/livesync` package with three entry points: a **server** (Hono/Bun WebSocket, runs inside the consumer's own app), a **client** (browser provider with reconnect, awareness, optional offline store), and **plug-in points** for auth (Broberg ID) and persistence (the consumer's database). The package owns the transport and the protocol; the consumer owns the document and where it is stored.

## Reuse
- **CRDT engine**: no match in Discovery roster (scripts/inventory-data.mjs, searched yjs/crdt/collab/presence/websocket 12/10) — wrap `yjs` 13.x + `y-protocols` 1.x (open source, MIT, no hosted service).
- **Hosted sync services (Liveblocks, PartyKit, Ably)**: rejected — US-hosted, and the owner's stance is no more US services than necessary (decision on Gravatar, same reasoning). Self-hosted on Fly `arn`.
- **Auth**: `@broberg/sso` — BID access tokens via `introspectToken` (0.17.0), and BID user tickets (BID F087.37, GO 12/10) via `createTicketVerifier` once it accepts `principal_type:"user"`.
- **Error/telemetry**: `@upmetrics/sdk` in the consumer, not in the package.
- **Logging**: `@broberg/logger` on the server side.
- **Hocuspocus** (`@hocuspocus/server`, a Yjs server framework): considered; open question whether to build on it or on plain y-protocols. Leaning plain: Hocuspocus is Node-oriented and brings its own extension model, while consumers here run Bun + Hono.

## Design
None for the package core (server + protocol). The presence UI (who is here, coloured cursors) in F100.4 is a visual surface — run `cardmem_design_consult` when that story is picked up; it builds on `@broberg/theme` tokens, Preact, no shadcn (D-7598d1), `data-testid` on every interactive element.

## Scope

### In scope
- `packages/livesync/` → `@broberg/livesync` with exports `./server`, `./client`, `./core`.
- Server: WebSocket upgrade handler for Hono/Bun, one room per document id, Yjs sync + awareness protocol, auth hook (reject before the first sync message), persistence hook (`load(docId)` / `store(docId, update)`, debounced), idle-room unload.
- Client: provider that connects, reconnects with backoff, exposes connection state (`connecting | synced | offline`) and awareness; IndexedDB offline store, ON for the first consumer (owner 12/10: offline is in).
- Access per document: the auth hook returns `read | write | none` for (user, docId); a read-only user receives updates but the server drops their writes.
- Tests: two simulated clients edit concurrently and converge; offline edits merge on reconnect; a token that fails auth gets no document; a read-only client cannot change the document (measured on the server copy).
- One example app in `examples/livesync/` that Lens can drive with two browser contexts.

### Out of scope
- Any hosted, fleet-wide sync service — rejected by the owner 12/10 (one server per app).
- Consumer document models, storage tables and migrations (the consumer's).
- Editor bindings beyond the first consumer's editor.
- cms F71 v1 (locking) — cms's own card.
- Fly-Live site sync (already `@broberg/deploy-core`) and database replication (infra).
- Version history / time travel UI (Yjs snapshots make it possible later; not now).

## Architecture

### Server (`@broberg/livesync/server`)
```ts
createLivesync({
  authenticate(req: Request, docId: string): Promise<{ sub: string; access: "read" | "write" } | null>,
  persistence: { load(docId: string): Promise<Uint8Array | null>; store(docId: string, state: Uint8Array): Promise<void> },
  storeDebounceMs?: number,      // default 2000
  unloadAfterIdleMs?: number,    // default 60000
}) → { upgrade(c: Context): Response }   // mount on a Hono route, e.g. app.get("/sync/:docId", lv.upgrade)
```
### Client (`@broberg/livesync/client`)
```ts
connect({ url, docId, getToken: () => Promise<string>, offline?: boolean })
  → { doc: Y.Doc; awareness; state: "connecting" | "synced" | "offline"; on(event, fn); destroy() }
```
`getToken` is called on every (re)connect, so a refreshed BID session is picked up without the app doing anything.

## Stories
- **F100.1** — Core: server + client + protocol, tested convergence and offline merge (no auth, in-memory persistence).
- **F100.2** — Auth + access: BID token check before sync, read/write per document, read-only writes dropped.
- **F100.3** — Persistence hook + the first consumer's document shape (blocked on open question 1).
- **F100.4** — Presence: who is in the document, cursors; example app driven by Lens with two browsers.
- **F100.5** — Publish 0.1.0, Discovery roster row, first consumer adopts.

## Acceptance criteria
1. Two clients editing the same document concurrently end with byte-identical document state, **measured in the package test suite on the server's copy** (not on either client's local view).
2. A client offline for edits merges on reconnect without losing either side's edits, **measured in the test suite**.
3. A request with an invalid or inactive BID token receives no document content, **measured as the bytes the server sent on the socket**, not as a UI message.
4. A read-only user's edits never reach the stored document, **read back from the persistence store after a fresh load**.
5. Two Lens browser contexts on `examples/livesync` each see the other's edit within 1 s, **measured by Lens on the running example**.
6. `@broberg/livesync` 0.1.0 is on npm and installs clean in a scratch project, and at least one consumer has adopted it (enrolled in Discovery).

## Dependencies
- F084.158 (`@broberg/sso` 0.17.0 introspectToken) — in publish 12/10.
- `createTicketVerifier` accepting user tickets (BID F087.37; broberg-id asked components 12/10, #2988) — only if the consumer authenticates with tickets rather than access tokens.

## Rollout
**Name and release pipeline are ready (12/10):** `@broberg/livesync` 0.0.1 is on npm as an empty placeholder (owner's OTP), Trusted Publisher is set up by Christian, and `publish.yml` has the `livesync-v*` job. The job runs `typecheck`, `build` and `test` in `packages/livesync` — those scripts arrive with F100.1, and no tag is pushed before then. 0.1.0 is the first usable version.

Single package, versioned. 0.x until the first consumer runs it in production. The server runs inside the consumer's own app on Fly `arn`, so there is nothing fleet-wide to roll back — a consumer pins the previous version.

## Effort estimate
**L** — ~4–6 days across the five stories, plus the first consumer's binding.

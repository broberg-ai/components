# @broberg/seti-server

Mountable [Hono](https://hono.dev) proxy router for **buddycloud.cc's SETI API v1** —
embed SET/SETI live streaming chat in a host app while the consumer token stays
server-side. The browser talks same-origin to the host (no CORS, host-app auth in
front, EventSource/fetch-SSE works with the host's cookies); this proxy injects the
bearer token server-to-server.

```ts
import { createSetiProxy } from "@broberg/seti-server";

// Gate with YOUR auth first, then mount:
app.use("/api/seti/*", hostAuthMiddleware);
app.route(
  "/api/seti",
  createSetiProxy({
    cloudUrl: process.env.SETI_CLOUD_URL!, // e.g. https://buddycloud.cc
    token: process.env.SETI_TOKEN!,        // a BUDDY_SETI_TOKENS consumer token
  }),
);
```

## Routes (1:1 against `{cloudUrl}/api/seti/v1/*`)

| Route | Method | Purpose |
| --- | --- | --- |
| `/sessions` | GET | Fleet roster: `{ edges: [{ edgeId, connected, tmuxSessions, sessions }] }`. `tmuxSessions` are the **streamable** units — use them as the `session` param. |
| `/stream?edge=&session=` | GET | SSE pass-through: `hello` / `frame` (full pane snapshot) / `ping`. |
| `/input` | POST | `{ edge, session, text? \| key? }` — text lines or nav-keys (`SETI_KEYS`). |

Pairs with [`@broberg/seti-client`](https://www.npmjs.com/package/@broberg/seti-client)
(typed client + frame-merge engine + Preact `<SetiChat>` component).

Peer dependency: `hono ^4`. No runtime dependencies.

MIT © broberg.ai

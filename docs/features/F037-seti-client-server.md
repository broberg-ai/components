# F037 — @broberg/seti-client + @broberg/seti-server

> Epic. Written 2026-06-12, ships same day. Contract owner: buddy **F071.10**
> (SETI API v1 on buddycloud.cc). First consumer: cardmem **PLAN → Chat**.

## Motivation

buddycloud.cc can stream any fleet cc-session (SET = headless Streaming Edge
Terminal, SETI = interactive) to a browser and inject input back — proven by the
F071 demo. cardmem must embed that capability **in its own product** so Christian
can watch + steer agents from anywhere. Rather than cardmem hand-rolling SSE
plumbing, frame merging, and token handling (and every future consumer repeating
it), the integration ships as two small packages — the same components-owns-pkg /
app-integrates split as @broberg/lens.

## The two packages

### @broberg/seti-server (`packages/seti-server`)

Mountable Hono router for the HOST app's server (Bun/Hono — cardmem, buddy,
future apps):

```ts
import { createSetiProxy } from '@broberg/seti-server';
// host gates with ITS OWN auth, then mounts:
app.use('/api/seti/*', hostAuthMiddleware);
app.route('/api/seti', createSetiProxy({ cloudUrl: env.BUDDY_CLOUD_URL, token: env.BUDDY_SETI_TOKEN }));
```

- Routes (1:1 → buddycloud `/api/seti/v1/*`): `GET /sessions`, `GET /stream` (SSE
  pass-through — fetch upstream with bearer, re-emit raw `text/event-stream` body),
  `POST /input`.
- The consumer token NEVER reaches the browser; same-origin proxy ⇒ no CORS, and
  EventSource works with the host's cookie auth.
- Peer dep: `hono ^4`. No other runtime deps.

### @broberg/seti-client (`packages/seti-client`)

Framework-agnostic core + Preact UI:

- **`FrameAccumulator`** — the F071 scrollback engine (splitFooter / mergeOverlap)
  extracted into a tested pure class: feed full capture-pane snapshots, get
  `{ history, footer }` (accumulated dialogue + live footer). Cap 5000 lines.
- **`SetiClient`** — `listSessions()`, `sendText(edge, session, text)`,
  `sendKey(edge, session, key)`, `openStream(edge, session, { onHello, onFrame,
  onPing, onStateChange })` → handle with `close()`. Browser: EventSource against
  the host proxy (same-origin). `baseUrl` config; optional `token` for
  server-side/direct use (then fetch-SSE instead of EventSource).
- **`@broberg/seti-client/preact`** — `<SetiChat baseUrl edge session />`: the
  complete mobile-first chat surface (status header, accumulated screen, nav-keys
  bar Esc/↑/↓/←/→/⏎, text input with delivery feedback — text preserved on
  failure). Self-contained styles via CSS vars (`--seti-*`) so host themes can
  override; every interactive element carries `data-testid="seti-chat-*"` per the
  fleet testid convention. Peer dep: `preact ^10`.

## Non-goals (v1)

- No React/vanilla UI wrapper (Preact covers cardmem + buddy web; core is
  framework-agnostic for later wrappers).
- No transcript/history beyond live forward-accumulation (buddy's
  transcript-backed scroll lands later as an API addition → minor version here).
- No session spawning — v1 talks to existing roster sessions.

## Testing

- FrameAccumulator: overlap-merge, footer split (prompt-line detection, rule line,
  spinner), history cap, idempotent repeated frames — the regression cases from the
  F071 night.
- seti-server: route mapping + bearer injection + 401 propagation (mock upstream).
- Component: typecheck (no jsdom e2e here — cardmem's Lens covers the rendered
  surface in-product).

## Publish

tsup (ESM+CJS+d.ts), `publishConfig.access=public`, repo-directory metadata — the
secret-scan pattern. `publish.yml` gets `seti-client-v*` / `seti-server-v*` jobs;
v0.1.0 bootstrapped manually (npm trusted-publisher needs a first publish), tags
from then on.

## Rollout

1. Scaffold both packages, lift + test FrameAccumulator, build SetiClient + proxy.
2. SetiChat Preact component (mobile-first, testids, CSS-var theme).
3. Publish v0.1.0 ×2 + extend publish.yml.
4. cardmem integrates (their session owns apps/web): mount proxy + PLAN→Chat route.
5. End-to-end proof vs a live edge SET; then /demo can retire later.

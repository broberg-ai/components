# @broberg/seti-client

Typed client + frame-merge engine + Preact `<SetiChat>` component for
**buddycloud.cc SET/SETI live streaming chat**. Consume it through a host-app
proxy from [`@broberg/seti-server`](https://www.npmjs.com/package/@broberg/seti-server)
(same-origin, host auth, no CORS — the consumer token never reaches the browser).

## Drop-in chat surface (Preact)

```tsx
import { SetiChat } from "@broberg/seti-client/preact";

<SetiChat baseUrl="/api/seti" edge="cb-ubuntu-docker" session="cc" />;
```

Complete mobile-first surface: status header, accumulated screen, nav-keys bar
(Esc/↑/↓/←/→/⏎) and a text input with delivery feedback (text preserved on
failure). Self-contained styles, themeable via CSS vars (`--seti-bg`,
`--seti-panel`, `--seti-edge`, `--seti-fg`, `--seti-dim`, `--seti-accent`,
`--seti-warn`, `--seti-bad`, `--seti-mono`, `--seti-radius`). Every interactive
element has `data-testid="seti-chat-*"`. Peer dependency `preact ^10` (optional —
the core export is framework-agnostic).

## Headless client

```ts
import { SetiClient, FrameAccumulator } from "@broberg/seti-client";

const client = new SetiClient({ baseUrl: "/api/seti" });

const roster = await client.listSessions();
// roster.edges[n].tmuxSessions = the STREAMABLE session names (use as `session`)

const acc = new FrameAccumulator();
const stream = client.openStream("cb-ubuntu-docker", "cc", {
  onFrame: (content) => console.log(acc.feed(content)), // { history, footer }
  onStateChange: (s) => console.log(s), // connecting | open | reconnecting | closed
});

await client.sendText("cb-ubuntu-docker", "cc", "Run the test suite, report back.");
await client.sendKey("cb-ubuntu-docker", "cc", "Enter");
stream.close();
```

“Start a task” on a headless SET and chatting with an interactive SETI are the
same call — `sendText` — because both are tmux cc sessions on the edge.

### A timeout is a measurement, not a fact about delivery (0.4.0)

`sendText` / `sendKey` return an **`outcome`** alongside `ok`, because "it
failed" and "I stopped waiting" are different things and only one of them is
safe to retry:

| `outcome` | what it means | retry? |
| --- | --- | --- |
| `delivered` | the server gave a verdict and it was yes | n/a |
| `rejected` | the server gave a verdict and it was no — **nothing was written** | yes, safely |
| `unconfirmed` | no verdict reached us: we hit our budget, the network broke, or the server answered without saying | **no — not automatically** |

```ts
const res = await client.sendText(edge, session, text);
if (res.outcome === "delivered") clearInput();
else if (res.outcome === "unconfirmed") warn("Uvist om den nåede frem — tjek før du sender igen");
else warn(`Afvist: ${res.error}`);
```

**Why `unconfirmed` must not be auto-retried:** `POST /input` is not idempotent.
An abort ends the *client's* wait; the edge may still inject the line. So a
retry is exactly how a false "not sent" becomes a real duplicate — which is the
bug this replaces. Christian saw "not sent" five times in a row on a single
message that had, in fact, arrived every time.

`ok` is unchanged and is `true` **only** for `delivered`, so nothing breaks. But
note that a UI branching on `!ok` shows a failure for `unconfirmed` too — that
is the case worth rendering differently, and `<SetiChat>` now does.

`FrameAccumulator` solves alt-screen scrollback: cc renders on the terminal
alt-screen (tmux keeps no scrollback), so every frame is a full window snapshot;
the accumulator overlap-merges successive frames into a growing dialogue history
plus a live footer.

Server-side/direct use: `new SetiClient({ baseUrl: "https://buddycloud.cc/api/seti/v1", token })`.

## SSE read-idle watchdog — `@broberg/seti-client/sse`

A generic, zero-dep SSE consumer with a **read-idle watchdog**, shared across the
fleet (0.3.0+). An SSE stream can go half-open (NAT drop / sleep / blip with no
FIN) → `reader.read()` blocks forever → a zombie stream that never reconnects
while the hub has long marked it dead. `consumeSSE` aborts a stream that got no
frame for `idleTimeoutMs` (default 90 s) so the caller's reconnect loop fires.

```ts
import { consumeSSE } from "@broberg/seti-client/sse";

while (running) {
  try {
    await consumeSSE(url, token, (event, data) => handle(event, data), {
      idleTimeoutMs: 90_000,
      onConnected: () => (backoff = 0), // reset backoff on a healthy connect
    });
  } catch {
    /* idle-abort or drop → fall through to the reconnect backoff */
  }
  await sleep(backoff);
}
```

Resolves when the stream closes; rejects on idle-abort or a non-OK response. The
hub must emit a frame (comment/ping) at least every ~30 s. Tree-shakeable — this
subpath pulls in none of the chat client or Preact.

MIT © broberg.ai

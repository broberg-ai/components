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

# @broberg/notify

Dark-ship **team-chat webhook notifications** for the broberg.ai fleet. One
message shape, fanned out to every configured incoming-webhook channel
(Discord + Slack today), with a per-channel delivery result.

```bash
npm i @broberg/notify
```

## Usage

```ts
import { createNotifier } from "@broberg/notify";

const notify = createNotifier({
  discord: { webhookUrl: process.env.DISCORD_WEBHOOK },   // a channel with no URL is skipped (dark-ship)
  slack:   { webhookUrl: process.env.SLACK_WEBHOOK },
});

const results = await notify.send({
  title: "Klar til gennemsyn",
  text: "📸 Dit ContentPush-opslag er klar",
  url: "https://contentpush.example/review/42",
});
// → posts to every configured channel
// results → [{ channel: "discord", ok: true, status: 204 }, { channel: "slack", ok: true, status: 200 }]
```

## Dark-ship

A channel is registered **only if its `webhookUrl` is present**. An unset env var
(`""`) means that channel is silently skipped — no crash, no half-wired surface in
prod. A notifier with **zero** configured channels is inert: `send()` is a no-op
that returns `[]` and never throws. Same posture as `@broberg/mail` / `@broberg/auth`.

```ts
createNotifier({}).channels;                       // []
await createNotifier({}).send({ text: "hi" });     // [] — nothing sent, no throw
createNotifier({ discord: { webhookUrl: "" } }).channels; // [] — empty URL = dark-shipped
```

## Per-channel isolation

`send()` posts to all channels concurrently and returns one `ChannelResult` per
channel. A network error or non-2xx on one channel **never** sinks the others:

```ts
// discord webhook is down, slack is fine:
// → [{ channel: "discord", ok: false, error: "fetch failed" },
//    { channel: "slack",   ok: true,  status: 200 }]
```

## Scope — chat channels only

`@broberg/notify` is deliberately fenced to **team-chat channels reached by an
incoming webhook**. It is *not* a universal notifier:

| You want to… | Use |
| --- | --- |
| Post to a Discord / Slack channel | **`@broberg/notify`** |
| Send an email | `@broberg/mail` |
| Send a browser / PWA push | `@broberg/webpush` |

Keeping the three non-overlapping is the point — `notify` never grows an email or
push transport. Later chat channels (Teams, Telegram, Mattermost — all the same
webhook-POST shape) are additive.

## Message mapping

One `NotifyMessage` maps to each channel's native payload:

| Field | Discord (`content`) | Slack (`text`) |
| --- | --- | --- |
| `title` | `**bold**` line | `*bold*` line |
| `text` | body line | body line |
| `url` | trailing line | trailing line |

Present fields are joined with newlines; absent ones are dropped.

## API

```ts
interface NotifyMessage { text: string; title?: string; url?: string; }
type ChannelName = "discord" | "slack";
interface ChannelResult { channel: ChannelName; ok: boolean; status?: number; error?: string; }
interface NotifierConfig { discord?: { webhookUrl: string }; slack?: { webhookUrl: string }; }
interface Notifier { send(msg: NotifyMessage): Promise<ChannelResult[]>; channels: ChannelName[]; }

function createNotifier(config: NotifierConfig): Notifier;
```

**Runtime deps: none** (global `fetch`). Webhook URLs are secrets — read them from
env, never hardcode. MIT · part of the [`@broberg/*`](https://github.com/broberg-ai/components)
shared-library family.

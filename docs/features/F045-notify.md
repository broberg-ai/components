# F045 — @broberg/notify: team-chat webhook notifications

**Status:** planned — awaiting Christian's go to build.
**Owner:** `components` (publishes the npm + owns the channel-adapter set).
**First consumer:** **ContentPush** (the social-content app, own repo/project) — its 14-day "your post is ready to review" reminder posts to Discord (and optionally Slack).

## Motivation
ContentPush's plan proposed a `@broberg/discord-notify`. Reuse-first check (Discovery, 2026-07-03): the fleet has **no** Discord/Slack/chat-webhook primitive — the nearest packages are `@broberg/webpush` (browser/PWA push, a different channel) and `@broberg/mail` (email). buddy's `discord_dm` is a fleet-internal agent→human tool, not an app-facing npm. So this is a genuine gap.

The anti-pattern we're preventing: ContentPush (or any app) doing a raw `fetch` to a Discord webhook URL. That IS the reuse violation — the test Christian applies is *"to swap the channel, do I change one place or seventeen?"* One shared primitive = one place.

## Scope (in)
1. **`createNotifier(config)`** — dark-ship factory. A channel is registered ONLY if its `webhookUrl` is present; a channel with no URL is silently skipped (no crash, no half-wired surface), mirroring `@broberg/mail` / `@broberg/auth`.
2. **Two channel adapters, one message shape.** Discord and Slack incoming-webhooks are near-identical (POST JSON to a webhook URL). One neutral `NotifyMessage` shape → per-channel payload mapping (Discord `{ content }`, Slack `{ text }`; title/url folded into the text/embed sensibly per channel).
3. **`notifier.send(msg)`** — fans out to ALL configured channels; returns a per-channel result array `{ channel, ok, status?, error? }` so a consumer can see which channel delivered. A failure on one channel never throws out the others (isolated per-channel try/catch).
4. **Pure-ish, minimal deps** — just `fetch` (global in Node 18+/Bun). No provider SDKs, no framework.
5. **vitest** — mock `fetch`, assert each channel's mapped payload + dark-ship skip + per-channel error isolation.
6. **Publish v0.1.0 to npm** (bootstrap) + README + OIDC tag workflow + Discovery inventory entry + self-enroll.

## Scope (out / non-goals — the scope-fence)
- **NOT email** — that is `@broberg/mail`. **NOT browser/PWA push** — that is `@broberg/webpush`. `@broberg/notify` is deliberately fenced to **team-chat channels reached by an incoming webhook**. This keeps the three notification packages non-overlapping (chat / email / browser-push).
- **No bot-token / interactive Discord/Slack apps, no slash-commands, no message threading/updates** — incoming-webhook one-shot posts only (v0.1.0). Richer surfaces are a later story only if a real consumer needs them.
- **No per-call channel targeting in v0.1.0** — `send` posts to all configured channels. Add `send(msg, { only: ['discord'] })` later if a consumer needs it (YAGNI now).
- **Later channels** (Teams, Telegram, Mattermost — all the same webhook-POST shape) are additive stories, not v0.1.0.

## Architecture
- **Message shape:** `interface NotifyMessage { text: string; title?: string; url?: string; }` — the neutral contract. Each adapter maps it: Discord → `{ content: [title, text, url].filter(Boolean).join('\n') }` (or a simple embed); Slack → `{ text: ... }` (mrkdwn). Kept minimal on purpose; richer per-channel options can extend the adapter later.
- **Dark-ship:** `createNotifier({ discord?: { webhookUrl }, slack?: { webhookUrl } })` builds an internal channel list from only the configured entries. Zero configured → `send` is a no-op returning `[]` (never throws), so a consumer that hasn't set any webhook yet stays inert in prod.
- **Per-channel isolation:** `send` awaits all channel POSTs (Promise.allSettled), maps each to `{ channel, ok, status?, error? }`. One channel's 4xx/timeout does not sink the others.
- **No secrets in code:** webhook URLs come from the consumer's env (`DISCORD_WEBHOOK`, `SLACK_WEBHOOK`), never hardcoded. Webhook URLs are secrets → `.env` / Fly-secret on the consumer side.

## Public API (sketch)
```ts
interface NotifyMessage { text: string; title?: string; url?: string; }
interface ChannelResult { channel: 'discord' | 'slack'; ok: boolean; status?: number; error?: string; }
interface NotifierConfig { discord?: { webhookUrl: string }; slack?: { webhookUrl: string }; }
interface Notifier { send(msg: NotifyMessage): Promise<ChannelResult[]>; channels: string[]; }

function createNotifier(config: NotifierConfig): Notifier;
```

## Dependencies
**Runtime: none** (global `fetch`). Dev: tsup, typescript, vitest. Mirrors `@broberg/secret-scan` / `@broberg/mail-core` monorepo conventions (pnpm workspace + turbo + tsup, dual ESM/CJS/DTS).

## Rollout
1. Build + test `@broberg/notify` v0.1.0 (F045.1).
2. Bootstrap-publish to npm + README + add `notify-v*` job/tag to publish.yml + Discovery inventory entry + self-enroll (F045.2). Christian sets up the Trusted Publisher post-bootstrap.
3. ContentPush adopts it as consumer #1 (exact-pin) — that card lives in ContentPush's own project.

## Acceptance criteria (epic)
- `@broberg/notify` v0.1.0 on npm; `createNotifier` + `send` + types resolve.
- Dark-ship proven: a notifier with no configured channel is inert (send → `[]`, no throw); a channel with no webhookUrl is not registered.
- Discord + Slack payloads mapped correctly from one `NotifyMessage`; per-channel failure isolated.
- README documents the API AND the scope-fence (chat-only; email→mail, push→webpush).
- Discovery roster lists F045 @broberg/notify; components self-enrolled as `src`.
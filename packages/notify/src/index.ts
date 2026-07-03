/**
 * @broberg/notify — team-chat webhook notifications for the broberg.ai fleet.
 *
 * `createNotifier(config)` builds a dark-ship notifier over incoming-webhook chat
 * channels (Discord + Slack today). `notifier.send(msg)` maps ONE neutral message
 * shape to each channel's payload and fans out to every configured channel,
 * returning a per-channel result so a caller can see which channel delivered.
 *
 * Scope-fence (deliberate): this package is ONLY team-chat channels reached by an
 * incoming webhook. Email is `@broberg/mail`; browser/PWA push is
 * `@broberg/webpush`. Keeping the three non-overlapping is the whole point —
 * `notify` never grows an email or push transport.
 *
 * Design choices:
 * - **Dark-ship** — a channel is registered ONLY if its `webhookUrl` is present
 *   (an unset env var → `""` → not registered). Zero channels → `send` is an
 *   inert no-op returning `[]`. So an app that hasn't wired a webhook yet stays
 *   silent in prod instead of crashing (same posture as `@broberg/mail`/`auth`).
 * - **Per-channel isolation** — one channel's network error / non-2xx never sinks
 *   the others; each POST is caught and reported as `{ ok:false, ... }`.
 * - **No provider SDKs, no framework** — just global `fetch`. Webhook URLs are
 *   secrets and come from the consumer's env, never hardcoded here.
 */

/** The neutral message shape. Each channel adapter maps this to its own payload. */
export interface NotifyMessage {
  /** the message body (required) */
  text: string;
  /** optional heading — rendered bold above the text */
  title?: string;
  /** optional link — appended on its own line */
  url?: string;
}

/** Which chat channels are supported. */
export type ChannelName = "discord" | "slack";

/** Per-channel delivery outcome (one per configured channel). */
export interface ChannelResult {
  channel: ChannelName;
  /** true iff the webhook returned a 2xx */
  ok: boolean;
  /** HTTP status, when a response was received */
  status?: number;
  /** error message, when the POST threw (network/abort) */
  error?: string;
}

export interface NotifierConfig {
  /** Discord incoming webhook (Server Settings → Integrations → Webhooks). */
  discord?: { webhookUrl: string };
  /** Slack incoming webhook (api.slack.com → Incoming Webhooks). */
  slack?: { webhookUrl: string };
}

export interface Notifier {
  /** Post `msg` to every configured channel; resolves to one result per channel. */
  send(msg: NotifyMessage): Promise<ChannelResult[]>;
  /** The channels actually registered (those given a non-empty `webhookUrl`). */
  channels: ChannelName[];
}

interface InternalChannel {
  name: ChannelName;
  webhookUrl: string;
  map: (msg: NotifyMessage) => Record<string, unknown>;
}

/** Join the present parts with newlines, dropping any empty/absent ones. */
function compose(parts: Array<string | undefined | null | false>): string {
  return parts.filter((p): p is string => Boolean(p)).join("\n");
}

/** Discord incoming-webhook payload — markdown `content`. */
function mapDiscord(msg: NotifyMessage): Record<string, unknown> {
  return { content: compose([msg.title && `**${msg.title}**`, msg.text, msg.url]) };
}

/** Slack incoming-webhook payload — mrkdwn `text`. */
function mapSlack(msg: NotifyMessage): Record<string, unknown> {
  return { text: compose([msg.title && `*${msg.title}*`, msg.text, msg.url]) };
}

async function post(channel: InternalChannel, msg: NotifyMessage): Promise<ChannelResult> {
  try {
    const res = await fetch(channel.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(channel.map(msg)),
    });
    return { channel: channel.name, ok: res.ok, status: res.status };
  } catch (e) {
    return { channel: channel.name, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Build a dark-ship notifier. Only channels given a non-empty `webhookUrl` are
 * registered; the rest are silently skipped.
 */
export function createNotifier(config: NotifierConfig): Notifier {
  const channels: InternalChannel[] = [];
  if (config.discord?.webhookUrl) {
    channels.push({ name: "discord", webhookUrl: config.discord.webhookUrl, map: mapDiscord });
  }
  if (config.slack?.webhookUrl) {
    channels.push({ name: "slack", webhookUrl: config.slack.webhookUrl, map: mapSlack });
  }
  return {
    channels: channels.map((c) => c.name),
    send(msg: NotifyMessage): Promise<ChannelResult[]> {
      if (channels.length === 0) return Promise.resolve([]);
      // post() never rejects (it catches internally), so one channel's failure
      // cannot sink the others.
      return Promise.all(channels.map((c) => post(c, msg)));
    },
  };
}

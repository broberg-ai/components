/**
 * @broberg/mail — the fleet's thin Resend send primitive.
 *
 * One consistent way to send transactional mail across every @broberg/* app:
 *  - a lazy, dependency-free client (raw POST to Resend's stable REST API, so it
 *    runs in Node, Bun and edge runtimes alike — no SDK, no version-floor),
 *  - a dev kill-switch + recipient allowlist so test/preview sends never reach
 *    real users (the fleet admins stay reachable for dev),
 *  - a typed { ok, id?, error?, skipped? } return that NEVER throws.
 *
 * It owns DELIVERY only. HTML templates stay per-app (they diverge per brand;
 * see F023). Lift the four-line `lazy init → allow-guard → send → {ok,error}`
 * chokepoint every repo currently duplicates into this one place.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Fleet admins always permitted as recipients, even when the allowlist gate is
 * active (dev/staging) — so a developer can always receive their own test mail.
 * The mirror of @broberg/lens's never-cb guard: there cb must never be the
 * principal; here cb must always be reachable.
 */
export const ALWAYS_ALLOWED = [
  "cb@webhouse.dk",
  "christian@broberg.ai",
  "christian@broberg.dk",
] as const;

export interface MailAttachment {
  filename: string;
  /** Raw bytes (base64-encoded for you) or an already-base64 string. */
  content: string | Uint8Array;
  contentType?: string;
  /** For inline images referenced as cid:<contentId> in the HTML. */
  contentId?: string;
}

export interface MailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  /** Overrides the mailer's default sender. "Name <email>" or a bare address. */
  from?: string;
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: MailAttachment[];
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
}

export interface MailResult {
  ok: boolean;
  /** Resend message id on a real send. */
  id?: string;
  error?: string;
  /** True when the send was intentionally NOT delivered (disabled / no key / not allowlisted). */
  skipped?: boolean;
}

export interface MailerConfig {
  /** Resend API key. Absent ⇒ ship-dark: every send is a logged no-op ({ ok: true, skipped: true }). */
  apiKey?: string;
  /** Default sender — "Name <email>" or a bare address (composed with fromName). */
  from?: string;
  /** Display name used when `from` is a bare address. */
  fromName?: string;
  /** When false, only allowlisted recipients are delivered to. Default: !!apiKey. */
  live?: boolean;
  /** Recipients permitted when !live. ALWAYS_ALLOWED are added automatically. */
  allowlist?: string[];
  /** Hard kill-switch: every send is a logged no-op ({ ok: true, skipped: true }). */
  disabled?: boolean;
  /** Injectable fetch (tests / custom runtimes). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Dev log sink for skipped/failed sends. Defaults to console.warn. */
  logger?: (message: string, meta?: unknown) => void;
}

export interface Mailer {
  send(message: MailMessage): Promise<MailResult>;
}

const list = (v: string | string[] | undefined): string[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

/** buildFrom("Sanne Andersen", "noreply@webhouse.dk") → "Sanne Andersen <noreply@webhouse.dk>". */
export function buildFrom(name: string | undefined, address: string): string {
  return name ? `${name} <${address}>` : address;
}

/**
 * Pure recipient gate. Returns true when EVERY recipient may be delivered to:
 * a live mailer passes unconditionally; otherwise each recipient must be in the
 * allowlist (or ALWAYS_ALLOWED). An empty recipient list ⇒ false.
 */
export function mailAllowed(
  to: string | string[],
  opts: { live?: boolean; allowlist?: string[] } = {},
): boolean {
  if (opts.live) return true;
  const recipients = list(to);
  if (recipients.length === 0) return false;
  const allowed = new Set(
    [...ALWAYS_ALLOWED, ...(opts.allowlist ?? [])].map((e) => e.toLowerCase()),
  );
  return recipients.every((r) => allowed.has(r.toLowerCase()));
}

function resolveFrom(config: MailerConfig, message: MailMessage): string | undefined {
  if (message.from) return message.from;
  if (!config.from) return undefined;
  // A configured `from` that already carries a display name is used verbatim.
  return config.from.includes("<") ? config.from : buildFrom(config.fromName, config.from);
}

function toBase64(content: string | Uint8Array): string {
  if (typeof content === "string") return content;
  if (typeof Buffer !== "undefined") return Buffer.from(content).toString("base64");
  let binary = "";
  for (const byte of content) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function createMailer(config: MailerConfig = {}): Mailer {
  const doFetch = config.fetch ?? globalThis.fetch?.bind(globalThis);
  const log =
    config.logger ?? ((m: string, meta?: unknown) => console.warn(`[@broberg/mail] ${m}`, meta ?? ""));
  const live = config.live ?? !!config.apiKey;

  return {
    async send(message: MailMessage): Promise<MailResult> {
      // Dev kill-switch / ship-dark: never crash a flow when mail is off.
      if (config.disabled || !config.apiKey) {
        log(`send skipped (${config.disabled ? "disabled" : "no RESEND key"})`, {
          to: message.to,
          subject: message.subject,
        });
        return { ok: true, skipped: true };
      }
      // Dev/staging allowlist gate — keep test mail off real users.
      if (!mailAllowed(message.to, { live, allowlist: config.allowlist })) {
        log("send skipped (recipient not in allowlist; mailer not live)", { to: message.to });
        return { ok: true, skipped: true };
      }
      const from = resolveFrom(config, message);
      if (!from) return { ok: false, error: "no_from (set MailerConfig.from or message.from)" };
      if (!doFetch) return { ok: false, error: "no_fetch (no global fetch; pass MailerConfig.fetch)" };

      const payload: Record<string, unknown> = {
        from,
        to: message.to,
        subject: message.subject,
      };
      if (message.html != null) payload.html = message.html;
      if (message.text != null) payload.text = message.text;
      if (message.replyTo != null) payload.reply_to = message.replyTo;
      if (message.cc != null) payload.cc = message.cc;
      if (message.bcc != null) payload.bcc = message.bcc;
      if (message.headers) payload.headers = message.headers;
      if (message.tags) payload.tags = message.tags;
      if (message.attachments?.length) {
        payload.attachments = message.attachments.map((a) => ({
          filename: a.filename,
          content: toBase64(a.content),
          ...(a.contentType ? { content_type: a.contentType } : {}),
          ...(a.contentId ? { content_id: a.contentId } : {}),
        }));
      }

      try {
        const res = await doFetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => ({}))) as {
          id?: string;
          message?: string;
          name?: string;
        };
        if (!res.ok) {
          const error = body.message ?? body.name ?? `resend_http_${res.status}`;
          log(`send failed: ${error}`, { status: res.status });
          return { ok: false, error };
        }
        return { ok: true, id: body.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "send_failed" };
      }
    },
  };
}

/**
 * Build a mailer from environment variables — the one-call setup for most apps:
 *   RESEND_API_KEY, MAIL_FROM, MAIL_FROM_NAME,
 *   MAIL_DISABLED (1/true), MAIL_LIVE (1/true), MAIL_ALLOWLIST (comma-separated)
 * Pass overrides to win over the environment.
 */
export function createMailerFromEnv(overrides: Partial<MailerConfig> = {}): Mailer {
  const env = (typeof process !== "undefined" ? process.env : {}) as Record<
    string,
    string | undefined
  >;
  const allowlist = env.MAIL_ALLOWLIST?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return createMailer({
    apiKey: env.RESEND_API_KEY,
    from: env.MAIL_FROM,
    fromName: env.MAIL_FROM_NAME,
    disabled: env.MAIL_DISABLED === "1" || env.MAIL_DISABLED === "true",
    live: env.MAIL_LIVE != null ? env.MAIL_LIVE === "true" || env.MAIL_LIVE === "1" : undefined,
    allowlist,
    ...overrides,
  });
}

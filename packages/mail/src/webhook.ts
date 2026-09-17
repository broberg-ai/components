// @broberg/mail/webhook — the half of delivery the send response cannot tell you.
//
// `send()` succeeding means the provider ACCEPTED the mail. It says nothing
// about arrival. delivered / bounced / complained only ever appear on the
// webhook stream, and nobody in the fleet receives that stream today — so we
// send to customers, club members and patients with no idea what fraction lands.
//
// The two outcomes demand opposite responses, which is why guessing is not an
// option: a bounced onboarding mail looks exactly like a delivered one the
// recipient ignored. One means fix the address and resend; the other means leave
// them alone. Without the stream you either nag people who got it or abandon
// people who did not.
//
// VERIFICATION IS THE LOAD-BEARING PART. An unverified webhook endpoint is an
// open write-surface where anyone can assert that anything was delivered — worse
// than having no delivery data at all, because it looks like evidence. So
// `verifyWebhook` returns a REASON, never a bare false, and the handlers refuse
// to run without a secret rather than defaulting to "unverified but working".
//
// Zero dependencies, like the rest of this package: node:crypto only.
import { MAIL_EVENT_TYPES, type MailEventType } from './events';

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How far a webhook timestamp may be from now. Guards replay of a captured
 *  request; 5 minutes is Svix's own tolerance. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type VerifyFailure =
  | 'no_secret'
  | 'missing_headers'
  | 'bad_secret_format'
  | 'timestamp_out_of_tolerance'
  | 'timestamp_not_a_number'
  | 'no_signature_match';

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

/** Header bag as delivered by any framework: case-insensitive lookup. */
export type HeaderLike = Headers | Record<string, string | string[] | undefined>;

function header(headers: HeaderLike, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const bag = headers as Record<string, string | string[] | undefined>;
  const hit = Object.keys(bag).find((k) => k.toLowerCase() === name);
  const value = hit ? bag[hit] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Verify a Resend (Svix) webhook signature over the RAW body.
 *
 * ⚠️ `rawBody` must be the bytes as received. A body that has been JSON.parsed
 * and re-stringified will not verify, and the failure looks like a wrong secret
 * — key ordering and whitespace both change the signature.
 */
export function verifyWebhook(
  rawBody: string,
  headers: HeaderLike,
  secret: string | undefined,
  options: { toleranceSeconds?: number; nowMs?: number } = {},
): VerifyResult {
  // Refusing here is deliberate. A missing secret must never fall through to
  // "accept everything" — that is the exact shape of a guard that reports
  // success because it never ran.
  if (!secret) return { ok: false, reason: 'no_secret' };

  const id = header(headers, 'svix-id');
  const timestamp = header(headers, 'svix-timestamp');
  const signature = header(headers, 'svix-signature');
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: 'timestamp_not_a_number' };
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = (options.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - sentAt) > tolerance) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  // whsec_<base64>. The prefix is optional in the wild; tolerate both.
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
    if (key.length === 0) return { ok: false, reason: 'bad_secret_format' };
  } catch {
    return { ok: false, reason: 'bad_secret_format' };
  }

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();

  // The header carries a space-separated list so a secret can be rotated with
  // both keys live. Any one match is a pass.
  for (const entry of signature.split(' ')) {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(value, 'base64');
    } catch {
      continue;
    }
    // Length check first: timingSafeEqual throws on a mismatch rather than
    // returning false, and a throw here would read as a server error instead of
    // a rejected signature.
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'no_signature_match' };
}

/** The delivery outcomes worth acting on, plus engagement. */
export type { MailEventType, MailVerdict } from './events';
export { MAIL_EVENT_TYPES, verdictForEvent } from './events';

export interface MailEvent {
  type: MailEventType;
  /** Provider message id — joins to the `id` a successful send() returned. */
  providerId?: string;
  to: string[];
  from?: string;
  subject?: string;
  /** Provider timestamp, ISO-8601, as sent. */
  at?: string;
  /** Bounce classification when the provider gives one (hard/soft/…). */
  bounceType?: string;
  /** The parsed payload, untouched, for anything this shape does not model. */
  raw: unknown;
}


/**
 * Parse a Resend webhook body into a typed event.
 *
 * Returns `null` for anything unrecognised rather than guessing — an event type
 * we do not model must not be silently reshaped into one we do. The caller
 * decides whether an unknown type is noise or a signal that the provider grew a
 * feature.
 */
export function parseMailEvent(rawBody: string): MailEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const b = body as { type?: unknown; created_at?: unknown; data?: Record<string, unknown> };
  if (typeof b.type !== 'string') return null;

  // "email.delivered" → "delivered". A type outside our union stays null.
  const short = b.type.startsWith('email.') ? b.type.slice(6) : b.type;
  if (!MAIL_EVENT_TYPES.includes(short as MailEventType)) return null;

  const data = (b.data ?? {}) as Record<string, unknown>;
  const to = data.to;
  const bounce = data.bounce as { type?: unknown } | undefined;

  return {
    type: short as MailEventType,
    providerId: typeof data.email_id === 'string' ? data.email_id : undefined,
    to: Array.isArray(to) ? to.filter((x): x is string => typeof x === 'string') : typeof to === 'string' ? [to] : [],
    from: typeof data.from === 'string' ? data.from : undefined,
    subject: typeof data.subject === 'string' ? data.subject : undefined,
    at: typeof b.created_at === 'string' ? b.created_at : undefined,
    bounceType: bounce && typeof bounce.type === 'string' ? bounce.type : undefined,
    raw: body,
  };
}

export interface WebhookHandlerConfig {
  /** Signing secret from the provider dashboard. Absent ⇒ every request is
   *  rejected; the endpoint never runs unverified. */
  secret?: string;
  /** Called once per verified, recognised event. Your persistence lives here. */
  onEvent: (event: MailEvent) => void | Promise<void>;
  /** Optional: observe rejected or unrecognised requests instead of losing them. */
  onIgnored?: (info: { reason: VerifyFailure | 'unparseable' | 'unknown_type'; rawBody: string }) => void;
  toleranceSeconds?: number;
}

/**
 * Framework-agnostic core: give it the raw body and headers, get back the status
 * to reply with. The Hono/Next adapters are three lines each on top of this.
 *
 * Returns 401 on a failed signature and 202 on anything accepted — including an
 * event type we do not model, because a verified request we chose not to act on
 * is not the sender's problem to retry.
 */
export async function handleMailWebhook(
  rawBody: string,
  headers: HeaderLike,
  config: WebhookHandlerConfig,
): Promise<{ status: 202 | 401; body: { ok: boolean; reason?: string } }> {
  const verified = verifyWebhook(rawBody, headers, config.secret, {
    toleranceSeconds: config.toleranceSeconds,
  });
  if (!verified.ok) {
    config.onIgnored?.({ reason: verified.reason, rawBody });
    return { status: 401, body: { ok: false, reason: verified.reason } };
  }

  const event = parseMailEvent(rawBody);
  if (!event) {
    config.onIgnored?.({ reason: 'unknown_type', rawBody });
    return { status: 202, body: { ok: true, reason: 'unknown_type' } };
  }

  await config.onEvent(event);
  return { status: 202, body: { ok: true } };
}

/**
 * Read an `email.received` webhook body as INBOUND mail.
 *
 * `null` for anything that is not `email.received` — a delivery event is not an
 * inbound mail, and reshaping one into the other is how a bounce would land in
 * someone's support queue as a customer message.
 *
 * ═══ WHAT THIS GIVES YOU, AND WHAT IT CANNOT ═══
 *
 * **It gives you the ENVELOPE. It does not give you the LETTER.** Measured
 * against the live API on 2026-09-17: the whole `data` object is
 *
 *     attachments · bcc · cc · created_at · email_id · from
 *     message_id · received_for · subject · to
 *
 * There is no `text`, no `html` and no `headers` — and the provider's receiving
 * documentation does not mention it. So this function is enough to ROUTE on
 * (which tenant, which recipient, is this a duplicate) and never enough to
 * STORE. For the body and the threading headers, take `emailId` to
 * `getInboundEmail()`.
 *
 * That split is deliberate: this is free and synchronous, the lookup costs a
 * network round trip and a key. A caller who only needs to route should not pay
 * for a fetch.
 *
 * `to` and `receivedFor` are ALWAYS lists here, with no string fallback — see
 * `InboundEmail` for the production failure that decided it.
 */
export function parseInboundMail(rawBody: string): InboundEnvelope | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.type !== "email.received") return null;
  const d = (b.data ?? {}) as Record<string, unknown>;

  const list = (v: unknown): string[] => {
    if (typeof v === "string") return v.trim() ? [v] : [];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
    return [];
  };
  const one = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

  const env: InboundEnvelope = {
    emailId: one(d.email_id ?? d.emailId) ?? "",
    to: list(d.to),
    cc: list(d.cc),
    bcc: list(d.bcc),
    receivedFor: list(d.received_for ?? d.receivedFor),
    raw: body,
  };
  const from = one(d.from);
  if (from !== undefined) env.from = from;
  const subject = one(d.subject);
  if (subject !== undefined) env.subject = subject;
  const messageId = one(d.message_id ?? d.messageId);
  if (messageId !== undefined) env.messageId = messageId;
  const at = one(b.created_at ?? d.created_at);
  if (at !== undefined) env.at = at;
  return env;
}

/**
 * What an `email.received` webhook actually carries.
 *
 * Named ENVELOPE rather than mail because that is literally all it is. The
 * absent fields are the informative ones: no body, no headers. See
 * `parseInboundMail`.
 */
export interface InboundEnvelope {
  /** The id to hand `getInboundEmail()` for the body + headers. */
  emailId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  receivedFor: string[];
  from?: string;
  subject?: string;
  /** RFC Message-ID — the intake key. Re-delivery of the same mail is ordinary
   *  operation, and without this key it becomes a second case. */
  messageId?: string;
  at?: string;
  /** The parsed payload, untouched, for anything this shape does not model. */
  raw: unknown;
}

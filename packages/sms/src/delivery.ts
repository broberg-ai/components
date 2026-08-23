// Delivery status — the half that says whether a message ARRIVED.
//
// F076.5. "Accepted" is the gateway saying it took the message. Every one of
// those costs money whether or not a handset ever saw it, so a repo without this
// is paying for sends it cannot prove landed.
//
// THREE PROVIDERS, THREE VOCABULARIES, AND ONE OF THEM HAS NO POLLING AT ALL:
//
//   GatewayAPI  webhook ONLY. They refuse to offer polling by design — "polling
//               solutions often make many requests that ultimately result in no
//               action". Signed with HMAC-SHA-256. Retried with exponential
//               backoff for up to 24 HOURS, so duplicates are guaranteed.
//   inMobile    webhook (statusCallbackUrl) OR GET /v4/sms/outgoing/reports,
//               which is READ-ONCE: each report is returned exactly once and
//               then deleted server-side.
//   sms.dk      webhook (dlrUrl, delivered by GET) OR POST /v1/sms/listlog,
//               which is repeatable and is the only one you can re-read.
//
// THE RULE THAT MATTERS MORE THAN THE MAPPING: a status we do not recognise
// becomes `unknown`, never `delivered` and never `failed`. Two of these three
// vocabularies are only partly documented — GatewayAPI publishes the RCS values
// and not the full SMS set — so the unrecognised case is the COMMON case, not
// the edge one. Guessing it into a definite state is how a message nobody
// received gets recorded as arrived.

/**
 * The five things that can be true of a sent message.
 *
 * `pending` and `unknown` are deliberately different: `pending` is the provider
 * saying "not yet", `unknown` is the provider saying nothing we understand.
 * inMobile distinguishes these itself (0 = Unknown) and so does sms.dk
 * (0 = No status yet), so collapsing them would throw away information the
 * gateways went to the trouble of giving us.
 */
export type DeliveryState = 'delivered' | 'failed' | 'expired' | 'pending' | 'unknown';

export interface DeliveryReport {
  provider: string;
  /** The provider's message id — the same value SmsResult.id carried. */
  id: string;
  state: DeliveryState;
  /** The provider's own status value, verbatim. Never discarded. */
  raw: string;
  recipient?: string;
  /** ISO 8601. ABSENT when the provider's timestamp could not be parsed. */
  at?: string;
  error?: string;
  /** Whether the provider says this was billed, where it says so. */
  charged?: boolean;
  /** The caller's own correlation value, when the provider echoes one back. */
  reference?: string;
  /** Segments the provider charged for — compare against estimate(). */
  segments?: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** ISO in, ISO out; anything unparseable is omitted rather than guessed. */
function iso(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  // sms.dk answers "23.08.2026 12.33.57" — Danish order AND dots for the time
  // separator. new Date() returns Invalid Date for it, so a naive
  // .toISOString() would throw rather than merely be wrong.
  const m = /^(\d{2})[.\-/](\d{2})[.\-/](\d{4})[ T](\d{2})[.:](\d{2})[.:](\d{2})$/.exec(v.trim());
  if (m) {
    const [, dd, MM, yyyy, hh, mi, ss] = m;
    const parsed = new Date(`${yyyy}-${MM}-${dd}T${hh}:${mi}:${ss}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

// ── GatewayAPI ───────────────────────────────────────────────────────────────

/**
 * Their SMS status values, as far as they publish them. The list is INCOMPLETE
 * on purpose: they document EXPIRED/DELIVERED/ENROUTE/READ for RCS and show
 * DELIVERED for SMS, without publishing the full SMS set. So anything not here
 * lands on `unknown` WITH its raw value, which is the honest answer and lets a
 * consumer see a status we have not met yet instead of it being silently
 * rounded to the nearest one we have.
 */
const GATEWAYAPI_STATES: Record<string, DeliveryState> = {
  DELIVERED: 'delivered',
  READ: 'delivered',
  ENROUTE: 'pending',
  ACCEPTED: 'pending',
  BUFFERED: 'pending',
  EXPIRED: 'expired',
  UNDELIVERABLE: 'failed',
  REJECTED: 'failed',
  DELETED: 'failed',
  UNKNOWN: 'unknown',
  SKIPPED: 'unknown',
};

/**
 * Parse a GatewayAPI webhook body. Returns [] for an event that is not an SMS
 * status (inbound messages, RCS reads) rather than inventing a report for it.
 * Never throws — a webhook handler that throws returns a non-2xx and earns a
 * 24-hour retry storm.
 */
export function parseGatewayApiWebhook(body: unknown): DeliveryReport[] {
  const events = Array.isArray(body) ? body : [body];
  const out: DeliveryReport[] = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const env = e as Record<string, unknown>;
    if (env.event_type !== 'message.status.sms') continue;
    const ev = (env.event ?? {}) as Record<string, unknown>;
    const id = str(ev.msg_id);
    if (!id) continue;
    const raw = str(ev.status) ?? '';
    out.push({
      provider: 'gatewayapi',
      id,
      state: GATEWAYAPI_STATES[raw.toUpperCase()] ?? 'unknown',
      raw,
      ...(ev.recipient != null ? { recipient: String(ev.recipient) } : {}),
      ...(iso(ev.status_at) ? { at: iso(ev.status_at) } : {}),
      ...(str(ev.error) ? { error: str(ev.error) } : {}),
    });
  }
  return out;
}

/**
 * Verify a GatewayAPI webhook signature. HMAC-SHA-256 over the RAW request body,
 * hex-encoded, sent as `Signature: v1=<hex>`.
 *
 * Pass the raw body STRING exactly as received — re-serialising a parsed object
 * changes the bytes (key order, whitespace, number formatting) and the signature
 * will not match. That is the single most common way this check fails.
 *
 * Uses crypto.subtle so it works on Node, Bun, Deno, workers and the browser
 * alike, which is why it is async. Comparison is constant-time.
 */
export async function verifyGatewayApiSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const provided = signatureHeader.startsWith('v1=') ? signatureHeader.slice(3) : signatureHeader;
  if (!/^[0-9a-fA-F]+$/.test(provided)) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // Constant-time: compare every character regardless of where the first
  // difference is, so the time taken says nothing about how close a guess was.
  const a = provided.toLowerCase();
  if (a.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= a.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ── inMobile ─────────────────────────────────────────────────────────────────

/** Their MessageStateCode: 0 Unknown · 1 Delivered · -1 Failed · -2 Cancelled. */
const INMOBILE_STATES: Record<string, DeliveryState> = {
  '1': 'delivered',
  '-1': 'failed',
  '-2': 'failed',
  '0': 'unknown',
};

/**
 * Parse the body of GET /v4/sms/outgoing/reports, or a statusCallbackUrl POST.
 *
 * READ-ONCE, and their words not mine: "Each report will only be returned once.
 * Once called, the status has been removed from our side and cannot be retrieved
 * again using this method." Persist the result before you filter it, and never
 * run two pollers — they will split the reports between them and each will
 * believe it saw everything.
 */
export function parseInMobileReports(body: unknown): DeliveryReport[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const list = Array.isArray(b.reports) ? b.reports : Array.isArray(body) ? (body as unknown[]) : [];
  const out: DeliveryReport[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const rep = r as Record<string, unknown>;
    const id = str(rep.messageId);
    if (!id) continue;
    const di = (rep.deliveryInfo ?? {}) as Record<string, unknown>;
    const ci = (rep.chargeInfo ?? {}) as Record<string, unknown>;
    const nd = (rep.numberDetails ?? {}) as Record<string, unknown>;
    const code = di.stateCode;
    const raw = code != null ? String(code) : '';
    out.push({
      provider: 'inmobile',
      id,
      state: INMOBILE_STATES[raw] ?? 'unknown',
      raw: str(di.stateDescription) ?? raw,
      ...(str(nd.msisdn) ? { recipient: str(nd.msisdn) } : {}),
      ...(iso(di.doneTime) ?? iso(di.sendTime) ? { at: iso(di.doneTime) ?? iso(di.sendTime) } : {}),
      ...(str(di.errorDescription) ? { error: str(di.errorDescription) } : {}),
      ...(typeof ci.isCharged === 'boolean' ? { charged: ci.isCharged } : {}),
      ...(typeof ci.smsCount === 'number' ? { segments: ci.smsCount } : {}),
    });
  }
  return out;
}

// ── sms.dk ───────────────────────────────────────────────────────────────────

/**
 * Their dlrStatus: 0 No status yet · 1 Received · 2 Rejected · 4 Expired ·
 * 8 Buffered. Note the values are powers of two — treat an unlisted value as
 * unknown rather than assuming the set is closed.
 *
 * 0 maps to `pending`, not `unknown`: "No status yet" is the gateway saying not
 * yet, which is a different fact from inMobile's 0 = "Unknown".
 */
const SMSDK_STATES: Record<string, DeliveryState> = {
  '0': 'pending',
  '1': 'delivered',
  '2': 'failed',
  '4': 'expired',
  '8': 'pending',
};

const SMSDK_LABELS: Record<string, string> = {
  '0': 'No status yet',
  '1': 'Received',
  '2': 'Rejected',
  '4': 'Expired',
  '8': 'Buffered',
};

/** Parse the body of POST /v1/sms/listlog. Repeatable — unlike inMobile's. */
export function parseSmsDkLog(body: unknown): DeliveryReport[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const result = (b.result ?? {}) as Record<string, unknown>;
  const list = Array.isArray(result.data) ? result.data : Array.isArray(body) ? (body as unknown[]) : [];
  const out: DeliveryReport[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const row = r as Record<string, unknown>;
    const id = str(row.batchId);
    if (!id) continue;
    const raw = row.dlrStatus != null ? String(row.dlrStatus) : '';
    out.push({
      provider: 'smsdk',
      id,
      state: SMSDK_STATES[raw] ?? 'unknown',
      raw: SMSDK_LABELS[raw] ?? raw,
      ...(row.receiver != null ? { recipient: String(row.receiver) } : {}),
      // "23.08.2026 12.33.57" — Danish order, dots in the TIME too. new Date()
      // calls this Invalid Date, so iso() handles it explicitly.
      ...(iso(row.timeSent) ? { at: iso(row.timeSent) } : {}),
      ...(typeof row.creditCost === 'number' ? { charged: row.creditCost > 0 } : {}),
      ...(typeof row.messageSize === 'number' ? { segments: row.messageSize } : {}),
    });
  }
  return out;
}

/**
 * Parse an sms.dk delivery report delivered to your `dlrUrl`, which they send
 * as a GET — so the data is in the query string, not a body.
 *
 * THE PARAMETER NAMES ARE NOT DOCUMENTED. Their reference states only that
 * "delivery reports will be sent to this address via GET" and never says what it
 * sends. So this reads the names their other surfaces use, and returns null
 * rather than a half-filled report when it cannot find an id — an unrecognised
 * callback must not be mistaken for a delivered message.
 *
 * NOT VERIFIED against a real callback (it needs a public URL). The log endpoint
 * above IS verified and needs no public URL; prefer it until this one has been
 * seen working.
 */
/**
 * sms.dk's delivery callback, which arrives as a GET with the payload in the
 * query string.
 *
 * WHAT IS PROVEN AND WHAT IS NOT, because the difference matters here:
 *
 *   PROVEN — the field NAMES below are not invented. They are the vocabulary
 *   sms.dk uses in its own delivery-log API, measured from a live response
 *   (test/fixtures/smsdk-log.live.json): batchId, dlrStatus, receiver, timeSent,
 *   userReference. Same provider, same concepts, same spelling.
 *
 *   NOT PROVEN — that the CALLBACK uses those same names. Their callback
 *   parameters are undocumented (docs.sms.dk and their Postman workspace both
 *   render as JavaScript apps with no readable content), and verifying it needs
 *   a publicly reachable URL for them to call, which this package cannot stand
 *   up. Tracked on F076.8.
 *
 * So this reads several spellings of each field rather than betting on one, and
 * returns null rather than a half-built report when it cannot find an id. If you
 * wire this and the reports come back empty, log the raw query string first —
 * that is the fastest way to find out what they actually send, and worth sending
 * back to components so the next repo does not repeat it.
 */
export function parseSmsDkDlr(query: URLSearchParams | Record<string, string>): DeliveryReport | null {
  const get = (k: string): string | undefined => {
    const v = query instanceof URLSearchParams ? query.get(k) : query[k];
    return v == null || v === '' ? undefined : String(v);
  };
  const id = get('batchId') ?? get('batchid') ?? get('messageId') ?? get('id');
  if (!id) return null;
  const raw = get('dlrStatus') ?? get('dlrstatus') ?? get('status') ?? '';
  return {
    provider: 'smsdk',
    id,
    state: SMSDK_STATES[raw] ?? 'unknown',
    raw: SMSDK_LABELS[raw] ?? raw,
    ...(get('receiver') ?? get('msisdn') ? { recipient: get('receiver') ?? get('msisdn') } : {}),
    ...(iso(get('timeSent') ?? get('timesent')) ? { at: iso(get('timeSent') ?? get('timesent')) } : {}),
    // Their own log API carries userReference, and it is the field a consumer
    // sets to correlate a callback back to their own record. Losing it here
    // would make the report arrive with nothing to attach it to.
    ...(get('userReference') ?? get('userreference')
      ? { reference: get('userReference') ?? get('userreference') }
      : {}),
  };
}

// ── Fetchers ─────────────────────────────────────────────────────────────────
//
// GatewayAPI deliberately has none. Their words: "By design the Mobile Message
// API does not include APIs for polling message states." For them it is the
// webhook or nothing, so verifyGatewayApiSignature + parseGatewayApiWebhook are
// the whole story.

export interface FetchOptions {
  apiKey: string;
  baseUrl?: string;
  /** 1..250 for inMobile, 1..1000 for sms.dk. */
  limit?: number;
  timeoutMs?: number;
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number, init?: RequestInit) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), ...init });
  const raw = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${raw.slice(0, 200)}`);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${res.status} but the body was not JSON: ${raw.slice(0, 160)}`);
  }
}

/**
 * DESTRUCTIVE READ. Every report this returns is deleted on inMobile's side and
 * cannot be fetched again — their words: "Each report will only be returned
 * once."
 *
 * So: persist what you get BEFORE you filter, transform or log it, and never run
 * two of these concurrently. Two pollers do not each see everything; they split
 * the reports between them and both believe they saw it all.
 */
export async function fetchInMobileReports(opts: FetchOptions): Promise<DeliveryReport[]> {
  const { apiKey, baseUrl = 'https://api.inmobile.com', limit = 250, timeoutMs = 15_000 } = opts;
  if (limit < 1 || limit > 250) throw new Error(`fetchInMobileReports: limit must be 1..250, got ${limit}.`);
  const body = await getJson(
    `${baseUrl.replace(/\/+$/, '')}/v4/sms/outgoing/reports?limit=${limit}`,
    { Authorization: `Basic ${btoa(`api:${apiKey}`)}`, Accept: 'application/json' },
    timeoutMs,
  );
  return parseInMobileReports(body);
}

/** Repeatable — sms.dk's log can be re-read, unlike inMobile's reports. */
export async function fetchSmsDkLog(opts: FetchOptions & { batchId?: string }): Promise<DeliveryReport[]> {
  const { apiKey, baseUrl = 'https://api.sms.dk', limit = 100, timeoutMs = 15_000, batchId } = opts;
  if (limit < 1 || limit > 1000) throw new Error(`fetchSmsDkLog: limit must be 1..1000, got ${limit}.`);
  const body = await getJson(
    `${baseUrl.replace(/\/+$/, '')}/v1/sms/listlog`,
    { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    timeoutMs,
    { method: 'POST', body: JSON.stringify({ limit, ...(batchId ? { batchId } : {}) }) },
  );
  return parseSmsDkLog(body);
}

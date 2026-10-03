// components-F005.21 — the other side of the webhook stream: what the provider
// tried to deliver to us, how each attempt went, and a way to send it again.
//
// The stream (F005.7) is the only place delivered / bounced / complained ever
// appear. When our endpoint was down or answered wrong, that event was lost to
// us and `last_event` stayed wrong, with no way to fetch it again. Resend's
// headless webhook API (changelog 16/9 2026, docs read 3/10 2026) closes that:
//
//   GET  /webhooks/{id}/events                    limit 1–100 (default 20), after
//   GET  /webhooks/{id}/events/{eventId}
//   GET  /webhooks/{id}/events/{eventId}/attempts limit, after
//   POST /webhooks/{id}/events/{eventId}/replay
//   POST /webhooks/{id}/signing-secret/rotate     both keys sign for 24 hours
//
// THE KEY: these endpoints need a FULL-ACCESS API key. Resend has no read-only
// key, and a send-only key answers 401. That 401 is reported as `could_not_ask`
// with that sentence in it, never as an empty list: "we could not look" read as
// "there is nothing" is how a gap stays a gap.
//
// Nothing here throws. Same result shape as `getInboundEmail`.

const RESEND_API = "https://api.resend.com";

export type WebhookEventStatus = "success" | "failed" | "attempting" | "pending";

export interface WebhookEventSummary {
  id: string;
  /** e.g. "email.delivered" — the provider's name, as sent. */
  type: string;
  createdAt: string;
  status: WebhookEventStatus | (string & {});
}

export interface WebhookEventDetail extends WebhookEventSummary {
  /** When the provider will try again on its own, if it will. */
  nextAttemptAt?: string;
  /** Exactly what was (or will be) POSTed to your endpoint. */
  payload: unknown;
}

export interface WebhookAttempt {
  id: string;
  /** What YOUR endpoint answered. */
  httpStatusCode: number;
  /** Your endpoint's response body, as text. */
  response: string;
  sentAt: string;
}

export interface WebhookPage<T> {
  items: T[];
  hasMore: boolean;
}

export type WebhookAdminResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_found"; detail: string }
  | { ok: false; reason: "could_not_ask"; detail: string };

export interface ReplayFailedReport {
  /** Event ids queued for another delivery. */
  replayed: string[];
  /** Events we tried to replay and could not, with why. */
  errors: { id: string; detail: string }[];
  /** How many events were looked at. */
  scanned: number;
  /** False when listing stopped early (an error, or `max` was reached). */
  complete: boolean;
  /** Set when listing itself failed; `replayed` holds what got done before. */
  listError?: string;
}

export interface WebhookAdminConfig {
  /** A FULL-ACCESS Resend key. A send-only key cannot read webhooks. */
  apiKey?: string;
  /** The webhook's id from the Resend dashboard or API. */
  webhookId: string;
  fetch?: typeof fetch;
}

export interface WebhookAdmin {
  listEvents(opts?: { limit?: number; after?: string }): Promise<WebhookAdminResult<WebhookPage<WebhookEventSummary>>>;
  getEvent(eventId: string): Promise<WebhookAdminResult<WebhookEventDetail>>;
  listAttempts(eventId: string, opts?: { limit?: number; after?: string }): Promise<WebhookAdminResult<WebhookPage<WebhookAttempt>>>;
  /** Queue one more delivery now. Does not touch the provider's own retry schedule. */
  replay(eventId: string): Promise<WebhookAdminResult<{ id: string }>>;
  /**
   * New signing secret. For 24 hours both old and new sign every payload, so
   * put the new one next to the old (`verifyWebhook` takes a list) and remove
   * the old after that. The value is returned to you and never logged here —
   * store it in the vault, not in a log or a chat.
   */
  rotateSecret(): Promise<WebhookAdminResult<{ signingSecret: string }>>;
  /**
   * Replay every event whose delivery FAILED, newest first, at most `max`
   * (default 50). Events that succeeded, or are still being attempted or
   * pending, are never replayed: the provider is already on those.
   */
  replayFailed(opts?: { max?: number; pageSize?: number }): Promise<ReplayFailedReport>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function toSummary(e: Record<string, unknown>): WebhookEventSummary {
  return { id: str(e.id), type: str(e.type), createdAt: str(e.created_at), status: str(e.status) };
}

export function createWebhookAdmin(config: WebhookAdminConfig): WebhookAdmin {
  const base = `${RESEND_API}/webhooks/${encodeURIComponent(config.webhookId ?? "")}`;

  async function call(method: "GET" | "POST", path: string): Promise<WebhookAdminResult<Record<string, unknown>>> {
    const doFetch = config.fetch ?? (typeof fetch === "function" ? fetch : undefined);
    if (!config.apiKey) return { ok: false, reason: "could_not_ask", detail: "no API key, so the provider was never asked" };
    if (!config.webhookId) return { ok: false, reason: "could_not_ask", detail: "no webhookId given" };
    if (!doFetch) return { ok: false, reason: "could_not_ask", detail: "no fetch available (pass config.fetch)" };
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${config.apiKey}` } });
    } catch (err) {
      return { ok: false, reason: "could_not_ask", detail: `could not reach the provider: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (res.status === 404) return { ok: false, reason: "not_found", detail: "the provider has no such webhook or event" };
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: "could_not_ask",
        detail: "this API key may not read webhooks (a send-only key answers 401; Resend has no read-only key, so this needs a full-access key) — this is NOT an empty result",
      };
    }
    if (!res.ok) return { ok: false, reason: "could_not_ask", detail: `the provider answered HTTP ${res.status}` };
    try {
      const body = (await res.json()) as unknown;
      if (!body || typeof body !== "object") return { ok: false, reason: "could_not_ask", detail: "the provider answered with no JSON object" };
      return { ok: true, value: body as Record<string, unknown> };
    } catch {
      return { ok: false, reason: "could_not_ask", detail: "the provider's answer was not JSON" };
    }
  }

  const query = (o: { limit?: number; after?: string } = {}) => {
    const q = new URLSearchParams();
    if (o.limit !== undefined) q.set("limit", String(Math.min(100, Math.max(1, Math.trunc(o.limit)))));
    if (o.after) q.set("after", o.after);
    const s = q.toString();
    return s ? `?${s}` : "";
  };
  const id = (x: string) => encodeURIComponent(x);
  const page = <T>(body: Record<string, unknown>, map: (e: Record<string, unknown>) => T): WebhookPage<T> => ({
    items: (Array.isArray(body.data) ? body.data : []).filter((e): e is Record<string, unknown> => !!e && typeof e === "object").map(map),
    hasMore: body.has_more === true,
  });

  const admin: WebhookAdmin = {
    async listEvents(opts) {
      const r = await call("GET", `/events${query(opts)}`);
      return r.ok ? { ok: true, value: page(r.value, toSummary) } : r;
    },
    async getEvent(eventId) {
      const r = await call("GET", `/events/${id(eventId)}`);
      if (!r.ok) return r;
      const e = r.value;
      const detail: WebhookEventDetail = { ...toSummary(e), payload: e.payload };
      if (typeof e.next_attempt_at === "string") detail.nextAttemptAt = e.next_attempt_at;
      return { ok: true, value: detail };
    },
    async listAttempts(eventId, opts) {
      const r = await call("GET", `/events/${id(eventId)}/attempts${query(opts)}`);
      return r.ok
        ? {
            ok: true,
            value: page(r.value, (a) => ({
              id: str(a.id),
              httpStatusCode: typeof a.http_status_code === "number" ? a.http_status_code : 0,
              response: str(a.response),
              sentAt: str(a.sent_at),
            })),
          }
        : r;
    },
    async replay(eventId) {
      const r = await call("POST", `/events/${id(eventId)}/replay`);
      return r.ok ? { ok: true, value: { id: str(r.value.id) || eventId } } : r;
    },
    async rotateSecret() {
      const r = await call("POST", "/signing-secret/rotate");
      if (!r.ok) return r;
      const signingSecret = str(r.value.signing_secret);
      return signingSecret
        ? { ok: true, value: { signingSecret } }
        : { ok: false, reason: "could_not_ask", detail: "the provider answered without a signing_secret" };
    },
    async replayFailed(opts = {}) {
      const max = opts.max ?? 50;
      const report: ReplayFailedReport = { replayed: [], errors: [], scanned: 0, complete: false };
      let after: string | undefined;
      for (;;) {
        const listed = await admin.listEvents({ limit: opts.pageSize ?? 100, after });
        if (!listed.ok) {
          report.listError = listed.detail;
          return report;
        }
        for (const e of listed.value.items) {
          report.scanned++;
          if (e.status !== "failed") continue;
          if (report.replayed.length + report.errors.length >= max) return report;
          const r = await admin.replay(e.id);
          if (r.ok) report.replayed.push(e.id);
          else report.errors.push({ id: e.id, detail: r.detail });
        }
        const last = listed.value.items[listed.value.items.length - 1];
        if (!listed.value.hasMore || !last) {
          report.complete = true;
          return report;
        }
        after = last.id;
      }
    },
  };
  return admin;
}

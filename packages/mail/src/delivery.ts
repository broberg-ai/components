// F005.23 — read delivery status for mails already sent: «did my mail to X arrive?».
// The PULL half of the delivery question (F005.7's webhook is the push half). fd-sundhed built
// this with a raw fetch to Resend's /emails list because the package had none (intercom 3810).
//
// TWO HONESTY RULES, the same as getStatus/getInboundEmail:
//   1. A key that may not read (a send-only key answers 401/403) is `read_not_permitted` —
//      NEVER an empty list, which would read as «we sent this person nothing».
//   2. The fleet's Resend key lists EVERY project's mail (fd-sundhed, 22/10). So nothing is
//      returned unfiltered: `to` is required, and only mails to that recipient come back.

const RESEND_EMAILS = "https://api.resend.com/emails";
/** Pages followed at most — 100 mails each. A larger history says so (`truncated`). */
export const DELIVERY_MAX_PAGES = 20;

export interface DeliveryQuery {
  /** The recipient. Required — the shared key would otherwise list other projects' mail. */
  to: string;
  /** Only mails from this sender (address, or «Name <address>»). */
  from?: string;
  /** Only mails created at or after this moment. Paging stops once it is passed. */
  since?: Date;
}

export interface DeliveryRecord {
  id: string;
  createdAt: string;
  /** Resend's latest event, e.g. "delivered", "bounced", "sent". "" if the provider gave none. */
  lastEvent: string;
  to: string[];
  from: string;
  subject: string;
}

export type DeliveryLookup =
  | { ok: true; mails: DeliveryRecord[]; truncated: boolean }
  | { ok: false; reason: "read_not_permitted" | "could_not_ask"; detail: string };

const addr = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase();
/** Resend writes «2026-10-22 10:11:32.123+00»; Date wants a T and a full offset. */
const when = (s: string) => new Date(s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).getTime();

export async function deliveryStatus(
  query: DeliveryQuery,
  config: { apiKey?: string; fetch?: typeof fetch } = {},
): Promise<DeliveryLookup> {
  const doFetch = config.fetch ?? (typeof fetch === "function" ? fetch : undefined);
  if (!config.apiKey) return { ok: false, reason: "could_not_ask", detail: "no API key, so the provider was never asked" };
  if (!doFetch) return { ok: false, reason: "could_not_ask", detail: "no fetch available (pass config.fetch)" };
  if (!query.to?.trim()) return { ok: false, reason: "could_not_ask", detail: "`to` is required — the key may list other projects' mail" };

  const to = addr(query.to);
  const from = query.from ? addr(query.from) : undefined;
  const since = query.since?.getTime();
  const mails: DeliveryRecord[] = [];
  let after: string | undefined;

  for (let page = 0; page < DELIVERY_MAX_PAGES; page++) {
    const url = `${RESEND_EMAILS}?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    let res: Response;
    try {
      res = await doFetch(url, { headers: { Authorization: `Bearer ${config.apiKey}` } });
    } catch (err) {
      return { ok: false, reason: "could_not_ask", detail: `could not reach the provider: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "read_not_permitted", detail: "this API key may not read sent mail (a send-only key) — this is NOT «nothing was sent»" };
    }
    if (!res.ok) return { ok: false, reason: "could_not_ask", detail: `the provider answered ${res.status}` };
    let body: { data?: Record<string, unknown>[]; has_more?: boolean };
    try { body = (await res.json()) as typeof body; } catch { return { ok: false, reason: "could_not_ask", detail: "the provider's answer was not JSON" }; }
    if (!Array.isArray(body.data)) return { ok: false, reason: "could_not_ask", detail: "the provider's answer had no data list" };

    let passedSince = false;
    for (const m of body.data) {
      const createdAt = typeof m.created_at === "string" ? m.created_at : "";
      if (since !== undefined && createdAt && when(createdAt) < since) { passedSince = true; continue; }
      const rcpts = (Array.isArray(m.to) ? m.to : typeof m.to === "string" ? [m.to] : []).filter((x): x is string => typeof x === "string");
      if (!rcpts.some((r) => addr(r) === to)) continue;
      const sender = typeof m.from === "string" ? m.from : "";
      if (from && addr(sender) !== from) continue;
      mails.push({
        id: typeof m.id === "string" ? m.id : "",
        createdAt,
        lastEvent: typeof m.last_event === "string" ? m.last_event : "",
        to: rcpts,
        from: sender,
        subject: typeof m.subject === "string" ? m.subject : "",
      });
    }
    const last = body.data.at(-1);
    if (passedSince || !body.has_more || !last || typeof last.id !== "string") return { ok: true, mails, truncated: false };
    after = last.id;
  }
  return { ok: true, mails, truncated: true };
}

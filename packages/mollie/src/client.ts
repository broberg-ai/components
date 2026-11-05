// F112.2 — a thin client over Mollie's v2 REST API (no SDK: one dependency fewer,
// and the routing/reversal fields are used exactly as Mollie documents them).
// Ship dark: without MOLLIE_API_KEY → { enabled: false, mollie: null }, never a throw.
import type { SplitLine } from "./split";

export const MOLLIE_API = "https://api.mollie.com/v2";

export interface MollieAmount { currency: string; value: string }
export interface MolliePayment {
  id: string;
  status: "open" | "canceled" | "pending" | "authorized" | "expired" | "failed" | "paid" | string;
  amount: MollieAmount;
  sequenceType?: "oneoff" | "first" | "recurring";
  customerId?: string;
  mandateId?: string;
  metadata?: unknown;
  _links?: { checkout?: { href: string } };
  [k: string]: unknown;
}
export interface MollieRoute { id: string; amount: MollieAmount; description?: string; destination: { type: "organization"; organizationId: string } }

export class MollieError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: string) {
    super(message);
    this.name = "MollieError";
  }
}

// Currencies Mollie handles without decimals. Everything else is 2 decimals (DKK, EUR …).
const ZERO_DECIMAL = new Set(["JPY", "ISK"]);

/** Minor units → Mollie's { currency, value: "123.45" }. */
export function toMollieAmount(minor: number, currency: string): MollieAmount {
  if (!Number.isInteger(minor) || minor < 0) throw new MollieError(`amount must be whole minor units ≥ 0, got ${minor}`, 400);
  const cur = currency.toUpperCase();
  if (ZERO_DECIMAL.has(cur)) return { currency: cur, value: String(minor) };
  return { currency: cur, value: `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}` };
}

/** Mollie's { value: "123.45" } → minor units. */
export function fromMollieAmount(a: MollieAmount): number {
  if (ZERO_DECIMAL.has(a.currency.toUpperCase())) return Number(a.value);
  const [w, f = ""] = a.value.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}

export interface RouteRecipient { organizationId: string }

export interface MollieClient {
  createCustomer(input: { name?: string; email?: string; metadata?: unknown }): Promise<{ id: string }>;
  /** First payment: the customer pays once in Mollie's checkout and a card mandate is created. Redirect to `checkoutUrl`. */
  createFirstPayment(input: { customerId: string; amount: number; currency: string; description: string; redirectUrl: string; webhookUrl?: string; method?: string; metadata?: unknown }): Promise<{ payment: MolliePayment; checkoutUrl: string | null }>;
  /** A monthly (or any later) charge on the mandate, without the customer present. */
  createRecurringPayment(input: { customerId: string; mandateId?: string; amount: number; currency: string; description: string; webhookUrl?: string; metadata?: unknown }): Promise<MolliePayment>;
  getPayment(id: string): Promise<MolliePayment>;
  listRoutes(paymentId: string): Promise<MollieRoute[]>;
  /**
   * Execute a split on a PAID payment with delayed routing: one route per line,
   * except `platform` (whatever is not routed stays with the platform). Idempotent:
   * a route already created for a recipient is not created again; a different
   * amount for the same recipient is refused (it would double-pay).
   */
  routePayment(input: { paymentId: string; lines: SplitLine[]; platform: string; recipients: Record<string, RouteRecipient> }): Promise<{ created: MollieRoute[]; existing: MollieRoute[] }>;
  /** Full refund that claws every route back (`reverseRouting`), or a partial one with explicit `routingReversals`. */
  refundPayment(input: { paymentId: string; amount: number; currency: string; description?: string; reverseRouting?: boolean; routingReversals?: Array<{ organizationId: string; amount: number }> }): Promise<{ id: string; status: string }>;
}

export interface CreateMollieClientOptions { apiKey?: string; fetch?: typeof fetch }
export type MollieClientResult =
  | { enabled: true; testMode: boolean; mollie: MollieClient }
  | { enabled: false; testMode: false; mollie: null };

const routeTag = (recipient: string) => `split:${recipient}`;

export function createMollieClient(opts: CreateMollieClientOptions = {}): MollieClientResult {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
  const apiKey = opts.apiKey ?? env.MOLLIE_API_KEY;
  if (!apiKey) return { enabled: false, testMode: false, mollie: null };
  const f = opts.fetch ?? fetch;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await f(`${MOLLIE_API}${path}`, {
      method,
      headers: { authorization: `Bearer ${apiKey}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch {
      // A proxy/edge error page (HTML) is still an answer with a status — report it as one.
      throw new MollieError(`Mollie ${method} ${path} → ${res.status} (not JSON)`, res.ok ? 502 : res.status);
    }
    if (!res.ok) throw new MollieError(`Mollie ${method} ${path} → ${res.status}${data?.title ? ` ${data.title}` : ""}`, res.status, data?.detail);
    return data as T;
  }

  const mollie: MollieClient = {
    async createCustomer({ name, email, metadata }) {
      const c = await call<{ id: string }>("POST", "/customers", { name, email, metadata });
      return { id: c.id };
    },
    async createFirstPayment({ customerId, amount, currency, description, redirectUrl, webhookUrl, method, metadata }) {
      const payment = await call<MolliePayment>("POST", "/payments", {
        amount: toMollieAmount(amount, currency), description, redirectUrl, webhookUrl, method, metadata,
        customerId, sequenceType: "first",
      });
      return { payment, checkoutUrl: payment._links?.checkout?.href ?? null };
    },
    async createRecurringPayment({ customerId, mandateId, amount, currency, description, webhookUrl, metadata }) {
      return call<MolliePayment>("POST", "/payments", {
        amount: toMollieAmount(amount, currency), description, webhookUrl, metadata,
        customerId, mandateId, sequenceType: "recurring",
      });
    },
    getPayment(id) {
      return call<MolliePayment>("GET", `/payments/${encodeURIComponent(id)}`);
    },
    async listRoutes(paymentId) {
      const r = await call<{ _embedded?: { routes?: MollieRoute[] } }>("GET", `/payments/${encodeURIComponent(paymentId)}/routes`);
      // Shape confirmed against Mollie's official SDK (PaymentListRoutesEmbedded.routes).
      // A missing list is an ERROR, never "no routes": reading it as empty would make
      // routePayment create every route again — paying the same people twice.
      if (!Array.isArray(r._embedded?.routes)) throw new MollieError(`Mollie returned no routes list for ${paymentId} — refusing to assume none exist`, 502);
      return r._embedded!.routes!;
    },
    async routePayment({ paymentId, lines, platform, recipients }) {
      const payment = await mollie.getPayment(paymentId);
      if (payment.status !== "paid") throw new MollieError(`payment ${paymentId} is ${payment.status}, not paid — routes can only be created on a paid payment`, 409);
      const paid = fromMollieAmount(payment.amount);
      const total = lines.reduce((s, l) => s + l.amount, 0);
      if (total !== paid) throw new MollieError(`split lines sum to ${total}, but the payment is ${paid}`, 400);
      const existing = await mollie.listRoutes(paymentId);
      const created: MollieRoute[] = [];
      for (const line of lines) {
        if (line.recipient === platform || line.amount === 0) continue;
        const to = recipients[line.recipient];
        if (!to?.organizationId) throw new MollieError(`no Mollie organization for recipient "${line.recipient}"`, 400);
        const already = existing.find((r) => r.description === routeTag(line.recipient));
        if (already) {
          if (fromMollieAmount(already.amount) !== line.amount)
            throw new MollieError(`a route for "${line.recipient}" already exists with a different amount — refusing to pay twice`, 409);
          continue;
        }
        created.push(await call<MollieRoute>("POST", `/payments/${encodeURIComponent(paymentId)}/routes`, {
          amount: toMollieAmount(line.amount, payment.amount.currency),
          description: routeTag(line.recipient),
          destination: { type: "organization", organizationId: to.organizationId },
        }));
      }
      return { created, existing };
    },
    async refundPayment({ paymentId, amount, currency, description, reverseRouting, routingReversals }) {
      if (reverseRouting && routingReversals) throw new MollieError("give reverseRouting OR routingReversals, not both", 400);
      return call<{ id: string; status: string }>("POST", `/payments/${encodeURIComponent(paymentId)}/refunds`, {
        amount: toMollieAmount(amount, currency), description,
        ...(reverseRouting ? { reverseRouting: true } : {}),
        ...(routingReversals ? { routingReversals: routingReversals.map((r) => ({ amount: toMollieAmount(r.amount, currency), source: { type: "organization", organizationId: r.organizationId } })) } : {}),
      });
    },
  };
  return { enabled: true, testMode: apiKey.startsWith("test_"), mollie };
}

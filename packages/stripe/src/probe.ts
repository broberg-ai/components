/**
 * F053.12 — Stripe never went down. It MOVED A FIELD, and everything kept
 * answering 200.
 *
 * Twice in two months Stripe broke sanneandersen in production, and neither
 * time was an outage:
 *
 *   F098.4  `current_period_end` moved off the Subscription onto its ITEMS.
 *   F102    `invoice.subscription` was REMOVED in `2026-04-22.dahlia`.
 *
 * A health check asking *"is Stripe up?"* would have been GREEN both times.
 * Both failed in the green direction — no exception, no log, a webhook branch
 * that quietly did not run. One of them was `invoice.payment_failed`, so a
 * declined card triggered literally nothing and the customer kept full access
 * without paying.
 *
 * So this does not check that Stripe answers. It checks that **the fields we
 * read are still where we read them** — by running our OWN readers over a real
 * test-mode payload and reporting WHICH LOCATION each one resolved from. A
 * reader that silently fell through to the deprecated location is the warning
 * that the current one has moved again.
 */
import { readPeriod, readSubscriptionId } from "./fields.js";
import type Stripe from "stripe";

/**
 * THREE OUTCOMES, NEVER TWO — and the third is the one that gets collapsed by
 * accident. An unreachable API reported as `drift` wakes someone for Stripe's
 * outage; reported as `ok` it hides a real move. Neither is a verdict about our
 * readers, so it gets its own name.
 */
export type ProbeStatus = "ok" | "drift" | "unknown";

/** Where a reader found its value. The location IS the finding, not a boolean. */
export type ResolvedFrom = "current" | "deprecated" | "not-found";

export interface ReaderReport {
  reader: "readPeriod" | "readSubscriptionId";
  resolved: boolean;
  from: ResolvedFrom;
}

export interface ProbeResult {
  status: ProbeStatus;
  readers: ReaderReport[];
  /** Present only when status is "unknown" — why we could not look. */
  reason?: string;
  /** What the probe created and removed again, so a leak is visible in the result. */
  cleanedUp: string[];
  /** Anything it created and could NOT remove. Non-empty is itself a finding. */
  leaked: string[];
}

export interface ProbeOptions {
  stripe: Stripe;
  /** The key the client was built with. Checked, not trusted. */
  apiKey: string;
}

/** A live key must never reach this. It creates and deletes objects. */
export class LiveKeyRefused extends Error {
  constructor() {
    super(
      "probeStripeShape refuses a non-test key. It CREATES and DELETES a customer, " +
        "product, price and subscription — that is safe in test mode and is not " +
        "something to point at a live account. Use an sk_test_ key.",
    );
    this.name = "LiveKeyRefused";
  }
}

const isNetworkish = (e: unknown): boolean => {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|fetch failed|socket hang up|StripeConnectionError|StripeAPIError/i.test(
    m,
  );
};

/**
 * Run our readers over a REAL test-mode payload.
 *
 * Returns rather than throws, because this runs on a schedule: a thrown error
 * is a stack trace in a cron log, and what the incident needs is a status.
 */
export async function probeStripeShape(opts: ProbeOptions): Promise<ProbeResult> {
  const { stripe, apiKey } = opts;

  // Checked FIRST, before anything is created — a refusal that happens after
  // the first write is not a refusal.
  if (!apiKey.startsWith("sk_test_") && !apiKey.startsWith("rk_test_")) throw new LiveKeyRefused();

  const cleanedUp: string[] = [];
  const leaked: string[] = [];
  const created: { kind: string; id: string; remove: () => Promise<unknown> }[] = [];

  try {
    const product = await stripe.products.create({ name: "F053.12 shape probe" });
    created.push({ kind: "product", id: product.id, remove: () => stripe.products.del(product.id) });

    const price = await stripe.prices.create({
      product: product.id,
      currency: "dkk",
      unit_amount: 1000,
      recurring: { interval: "month" },
    });

    const customer = await stripe.customers.create({ description: "F053.12 shape probe" });
    created.push({ kind: "customer", id: customer.id, remove: () => stripe.customers.del(customer.id) });

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      trial_period_days: 7,
    });
    created.push({ kind: "subscription", id: sub.id, remove: () => stripe.subscriptions.cancel(sub.id) });

    const readers: ReaderReport[] = [
      periodReport(sub),
      subscriptionIdReport(sub),
    ];

    // DRIFT is "did not resolve, OR resolved from somewhere we did not expect".
    // The second half is the early warning: the reader still works today,
    // because the fallback caught it, and the current location has moved.
    const drifted = readers.some((r) => !r.resolved || r.from !== "current");

    return { status: drifted ? "drift" : "ok", readers, cleanedUp, leaked };
  } catch (e) {
    if (isNetworkish(e)) {
      return {
        status: "unknown",
        readers: [],
        reason: `could not reach Stripe: ${e instanceof Error ? e.message : String(e)}`,
        cleanedUp,
        leaked,
      };
    }
    throw e;
  } finally {
    // Newest first, so a subscription is gone before its customer.
    for (const c of created.reverse()) {
      try {
        await c.remove();
        cleanedUp.push(`${c.kind}:${c.id}`);
      } catch {
        leaked.push(`${c.kind}:${c.id}`);
      }
    }
  }
}

function periodReport(sub: Stripe.Subscription): ReaderReport {
  const p = readPeriod(sub);
  if (!p.ok) return { reader: "readPeriod", resolved: false, from: "not-found" };
  const items = (sub as { items?: { data?: unknown } }).items?.data;
  const item = (Array.isArray(items) ? items[0] : null) as { current_period_end?: unknown } | null;
  return {
    reader: "readPeriod",
    resolved: true,
    from: typeof item?.current_period_end === "number" ? "current" : "deprecated",
  };
}

function subscriptionIdReport(sub: Stripe.Subscription): ReaderReport {
  // A subscription's own id is not what readSubscriptionId reads — it reads an
  // INVOICE. A trialing subscription has no paid invoice yet, so the honest
  // report here is about the invoice the subscription points at, when it has
  // one, and "not-found" when it does not exist YET rather than a false drift.
  const latest = (sub as { latest_invoice?: unknown }).latest_invoice;
  if (!latest) return { reader: "readSubscriptionId", resolved: false, from: "not-found" };
  const invoice = latest as Stripe.Invoice;
  const id = readSubscriptionId(invoice);
  if (!id) return { reader: "readSubscriptionId", resolved: false, from: "not-found" };
  const parent = (invoice as { parent?: { subscription_details?: { subscription?: unknown } } }).parent;
  return {
    reader: "readSubscriptionId",
    resolved: true,
    from: parent?.subscription_details?.subscription ? "current" : "deprecated",
  };
}

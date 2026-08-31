/**
 * Reading Stripe's MOVED fields.
 *
 * Filed by sanneandersen after the same failure class hit them twice in two
 * months. Both times Stripe relocated a field, both times the old read returned
 * `undefined`, and both times the code carried on:
 *
 *   F098.4  `current_period_end` moved off the Subscription onto its ITEMS.
 *           Their only paying subscriber ended up with no renewal date — and
 *           because "no end date" means "gift without expiry" in their access
 *           rule, a CANCELLED paying subscription would have kept access
 *           forever.
 *
 *   F102    `invoice.subscription` was REMOVED in `2026-04-22.dahlia`. Measured
 *           on a real live invoice: the key is not merely null, it is absent.
 *           Two webhook branches read the old place and fell out with `break`.
 *           One of them was `invoice.payment_failed` — so a declined card
 *           triggered literally nothing: no status change, no message, and the
 *           customer kept full access without paying.
 *
 * BOTH FAILED IN THE GREEN DIRECTION. No exception, no log, just a branch that
 * quietly did not run — which is why no test caught either one, and why both
 * were found by reading the live payload rather than the code.
 *
 * They live here because the webhook chain is already ours: we hand the consumer
 * the payload, and then every repo digs the fields out of it themselves. So each
 * time Stripe moves something, ONE repo discovers it at a time, and always
 * because something has already gone wrong for a paying customer.
 *
 * NEW LOCATION FIRST, OLD LOCATION AS FALLBACK, in both functions. A stored
 * event from an older API version still carries the old shape, and a webhook
 * replay must not become a second outage.
 *
 * NULL, NEVER A THROW. These run inside a webhook handler, where an exception
 * means the event is never acknowledged and Stripe retries it forever.
 */
import type Stripe from "stripe";

/** An id arrives either as a string or as an expanded object. */
function asId(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (v && typeof v === "object") {
    const id = (v as { id?: unknown }).id;
    if (typeof id === "string") return id || null;
  }
  return null;
}

/** A usable epoch-seconds timestamp, or null. Zero and negatives are not dates. */
function asSeconds(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** The three shapes the subscription id can arrive in, whatever the SDK types say. */
type InvoiceWithSubscription = {
  parent?: {
    subscription_details?: { subscription?: unknown } | null;
  } | null;
  lines?: {
    data?: Array<{
      parent?: { subscription_item_details?: { subscription?: unknown } | null } | null;
    } | null> | null;
  } | null;
  /** Removed in `2026-04-22.dahlia`. Still read, for older stored payloads. */
  subscription?: unknown;
};

/**
 * Which subscription does this invoice belong to?
 *
 * Returns `null` when the invoice is not part of a subscription — a one-off
 * invoice has none, and that is not an error.
 *
 * Order: `parent.subscription_details` → any LINE's
 * `subscription_item_details` → the removed top-level `subscription`.
 *
 * WHY EVERY LINE, not `lines.data[0]`: a renewal invoice can carry a proration
 * credit, and nothing guarantees the subscription line is first. Reading index 0
 * alone would fall through to the REMOVED field and return null — the same
 * silent no-op this function exists to end. (sanne's original read index 0; we
 * have not observed a proration-first invoice, so this covers a shape we infer
 * rather than one we measured.)
 */
export function readSubscriptionId(invoice: Stripe.Invoice | null | undefined): string | null {
  if (!invoice || typeof invoice !== "object") return null;
  const f = invoice as unknown as InvoiceWithSubscription;

  const fromParent = asId(f.parent?.subscription_details?.subscription);
  if (fromParent) return fromParent;

  const lines = Array.isArray(f.lines?.data) ? f.lines.data : [];
  for (const line of lines) {
    const fromLine = asId(line?.parent?.subscription_item_details?.subscription);
    if (fromLine) return fromLine;
  }

  return asId(f.subscription);
}

/** The period fields, wherever Stripe has put them this month. */
type WithPeriod = {
  current_period_start?: unknown;
  current_period_end?: unknown;
};

export interface SubscriptionPeriod {
  /** Start of the current period, in MILLISECONDS. */
  start: number | null;
  /** End of the current period, in MILLISECONDS. */
  end: number | null;
}

/**
 * The current billing period, in MILLISECONDS (Stripe reports seconds).
 *
 * Reads the subscription ITEM first — where Stripe puts it now — and falls back
 * to the subscription top level for older payloads.
 *
 * ⚠️ `null` MEANS "COULD NOT READ IT". It does NOT mean "no expiry". That
 * translation is the whole of F098.4: their access rule treated a missing end
 * date as an unlimited gift, so an unreadable field silently became free
 * lifetime access for a cancelled subscription. If your app grants access on a
 * missing date, branch on `null` explicitly before you get there.
 *
 * NOTHING IS GUESSED. A fallback like `now + 30 days` writes a number that looks
 * right and is not — and a wrong date is never noticed, where a missing one is.
 */
export function readPeriod(
  subscription: Stripe.Subscription | null | undefined,
): SubscriptionPeriod {
  if (!subscription || typeof subscription !== "object") return { start: null, end: null };

  const items = (subscription as { items?: { data?: unknown } }).items?.data;
  const item = (Array.isArray(items) ? items[0] : null) as WithPeriod | null;
  const top = subscription as unknown as WithPeriod;

  const start = asSeconds(item?.current_period_start) ?? asSeconds(top.current_period_start);
  const end = asSeconds(item?.current_period_end) ?? asSeconds(top.current_period_end);

  return {
    start: start === null ? null : start * 1000,
    end: end === null ? null : end * 1000,
  };
}

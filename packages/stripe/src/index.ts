/**
 * @broberg/stripe — the fleet's one Stripe chokepoint.
 *
 * Four primitives extracted from sanneandersen-site's proven live Connect
 * marketplace, so no @broberg/* app re-rolls raw `new Stripe()`, raw
 * `constructEvent`, or raw destination-charges (the exact drift the reuse-first
 * house rule exists to kill):
 *
 *  - `createStripeClient()`        — a pinned-apiVersion client factory that
 *                                    DARK-SHIPS: no key → inert, never throws.
 *  - `createFeeCalculator(config)` — the platform-fee MATHS (values injected by
 *                                    the consumer; they are app-specific).
 *  - `buildConnectCheckout()`      — a Connect destination-charge Checkout-Session
 *                                    builder (application_fee + on_behalf_of +
 *                                    transfer_data + metadata.kind).
 *  - `createStripeWebhookHandler()`— a raw-body webhook factory (constructEvent +
 *                                    dispatch-by-event.type to consumer handlers).
 *
 * The `/next` subpath adds a Web-standard Request/Response route factory.
 *
 * The package owns the SHAPE only. Fee values, the connected-account id,
 * fulfillment per `kind`, and price-ID resolution all stay app-side.
 */
import Stripe from "stripe";

/**
 * Pinned Stripe API version — one date for the whole fleet, so every consumer
 * speaks the same wire regardless of when they installed. Matches sanneandersen.
 */
export const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;

/** Injectable constructor — the real `Stripe` by default; a fake in tests. */
export type StripeConstructor = new (key: string, config?: Record<string, unknown>) => Stripe;

export interface CreateStripeClientOptions {
  /** Defaults to `process.env.STRIPE_SECRET_KEY`. */
  secretKey?: string;
  /** Defaults to {@link STRIPE_API_VERSION}. */
  apiVersion?: string;
  /** Extra Stripe config merged into the constructor call (e.g. `maxNetworkRetries`). */
  config?: Record<string, unknown>;
  /** Override the constructor (tests / advanced). */
  stripeCtor?: StripeConstructor;
}

export interface StripeClient {
  /** False when no secret key is configured (dark-ship) — `stripe` is null. */
  enabled: boolean;
  stripe: Stripe | null;
  /** True when the key is a `sk_test_…` key. */
  isTestMode: boolean;
}

/**
 * Build a Stripe client with the fleet-pinned apiVersion. DARK-SHIP: with no
 * secret key it returns `{ enabled:false, stripe:null }` and never constructs,
 * so an app that hasn't set `STRIPE_SECRET_KEY` boots fine (no half-wired
 * payments surface in prod).
 */
export function createStripeClient(opts: CreateStripeClientOptions = {}): StripeClient {
  const secretKey = opts.secretKey ?? process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { enabled: false, stripe: null, isTestMode: false };
  }
  const Ctor = opts.stripeCtor ?? (Stripe as unknown as StripeConstructor);
  const apiVersion = opts.apiVersion ?? STRIPE_API_VERSION;
  const stripe = new Ctor(secretKey, { apiVersion, ...opts.config });
  return { enabled: true, stripe, isTestMode: secretKey.startsWith("sk_test_") };
}

// ── Fee calculator ──────────────────────────────────────────────────────────

/** Map of a payment `type` → its platform-fee percent. Values are app-specific. */
export type FeeConfig = Record<string, number>;

export interface FeeCalculator {
  /** Application fee in øre for `amountØre` of the given `type` (integer-rounded). */
  calculateApplicationFee(amountØre: number, type: string): number;
  /** The configured percent for `type`, or undefined if none. */
  percentFor(type: string): number | undefined;
}

/**
 * The platform-fee MATHS. The package owns rounding + the calc shape; the
 * consumer injects the percentages (they are business numbers that stay in the
 * consuming app, one source, never hardcoded across the fleet).
 */
export function createFeeCalculator(config: FeeConfig): FeeCalculator {
  return {
    percentFor: (type) => config[type],
    calculateApplicationFee(amountØre, type) {
      const pct = config[type];
      if (pct == null) {
        console.warn(
          `[@broberg/stripe] no fee configured for type "${type}" — application fee = 0`,
        );
        return 0;
      }
      return Math.round((amountØre * pct) / 100);
    },
  };
}

// ── Connect checkout builder ────────────────────────────────────────────────

export interface ConnectCheckoutParams {
  mode: "payment" | "subscription";
  lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
  /** Connected account id the charge is destined for (on_behalf_of + transfer_data). */
  destination: string;
  successUrl: string;
  cancelUrl: string;
  /** Session metadata — include the `kind` routing-signal (booking/shop/…). */
  metadata?: Stripe.MetadataParam;
  /** payment mode: flat application fee in øre. */
  applicationFeeAmount?: number;
  /** subscription mode: application fee as a percent (Connect uses a percent, not a flat fee). */
  applicationFeePercent?: number;
  customer?: string;
  customerEmail?: string;
  clientReferenceId?: string;
  /**
   * payment mode: extra PaymentIntent fields (`description`, `receipt_email`, a
   * RICHER `metadata` than the session, …). Deep-merged INTO payment_intent_data;
   * the Connect invariants (`on_behalf_of`, `transfer_data`) and the fee always
   * win over anything set here. PaymentIntent metadata comes ONLY from here — the
   * session `metadata` is NOT auto-copied onto the PaymentIntent (so a route that
   * wants no PI metadata simply omits this).
   */
  paymentIntentData?: Partial<Stripe.Checkout.SessionCreateParams.PaymentIntentData>;
  /**
   * subscription mode: extra Subscription fields (`description`, own `metadata`,
   * …). Merged INTO subscription_data; `on_behalf_of`, `transfer_data` and the
   * fee percent always win. Subscription metadata comes ONLY from here.
   */
  subscriptionData?: Partial<Stripe.Checkout.SessionCreateParams.SubscriptionData>;
  /** Escape hatch for any other TOP-LEVEL Checkout Session param (not PI/sub — use the fields above for those). */
  extra?: Partial<Stripe.Checkout.SessionCreateParams>;
}

/**
 * Build a Connect destination-charge Checkout Session. In `payment` mode the
 * Connect params land under `payment_intent_data`; in `subscription` mode under
 * `subscription_data` (with `application_fee_percent`). Returns the created
 * session — the consumer redirects to `session.url` (hosted Checkout).
 *
 * The consumer owns the rest of the PaymentIntent/Subscription shape via
 * `paymentIntentData` / `subscriptionData` (description, receipt_email, a richer
 * metadata than the session, …); those are merged in FIRST and the Connect
 * invariants — `on_behalf_of`, `transfer_data.destination` and the fee — are
 * applied AFTER so they always win. Session `metadata` is NEVER auto-copied onto
 * the PaymentIntent/Subscription (a route that wants none simply omits it there).
 */
export async function buildConnectCheckout(
  stripe: Stripe,
  params: ConnectCheckoutParams,
): Promise<Stripe.Checkout.Session> {
  const base: Stripe.Checkout.SessionCreateParams = {
    mode: params.mode,
    line_items: params.lineItems,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    ...(params.metadata ? { metadata: params.metadata } : {}),
    ...(params.customer ? { customer: params.customer } : {}),
    ...(params.customerEmail ? { customer_email: params.customerEmail } : {}),
    ...(params.clientReferenceId ? { client_reference_id: params.clientReferenceId } : {}),
    ...params.extra,
  };

  if (params.mode === "payment") {
    base.payment_intent_data = {
      ...params.paymentIntentData, // consumer fields (description, receipt_email, own metadata)
      on_behalf_of: params.destination, // Connect invariants ALWAYS win
      transfer_data: { destination: params.destination },
      ...(params.applicationFeeAmount != null
        ? { application_fee_amount: params.applicationFeeAmount }
        : {}),
    };
  } else {
    base.subscription_data = {
      ...params.subscriptionData,
      on_behalf_of: params.destination,
      transfer_data: { destination: params.destination },
      ...(params.applicationFeePercent != null
        ? { application_fee_percent: params.applicationFeePercent }
        : {}),
    };
  }

  return stripe.checkout.sessions.create(base);
}

// ── Webhook handler factory ─────────────────────────────────────────────────

export type StripeEventHandler = (event: Stripe.Event) => void | Promise<void>;

export interface WebhookHandlerConfig {
  stripe: Stripe;
  /** `STRIPE_WEBHOOK_SECRET`. When absent, see `allowUnverifiedInDev`. */
  secret?: string;
  /** Map of `event.type` → handler. Unlisted types are acked (200) via `onUnhandled`. */
  handlers: Record<string, StripeEventHandler>;
  onUnhandled?: (event: Stripe.Event) => void | Promise<void>;
  /**
   * Dev only: when no `secret` is set, parse the body WITHOUT signature
   * verification (with a loud warn). Never enable in prod.
   */
  allowUnverifiedInDev?: boolean;
}

export interface WebhookResult {
  ok: boolean;
  /** HTTP status the route should return to Stripe. */
  status: number;
  event?: Stripe.Event;
  error?: string;
}

export type StripeWebhookHandler = (
  rawBody: string | Buffer,
  signature: string | null,
) => Promise<WebhookResult>;

/**
 * Verify + dispatch a Stripe webhook. Preserves the raw-body invariant
 * (`constructEvent` is fed the exact bytes, never a re-serialized object) and
 * ACKs unhandled event types with 200 so Stripe doesn't retry them. A bad
 * signature is a 400; a throwing handler is a 500 (Stripe retries).
 */
export function createStripeWebhookHandler(config: WebhookHandlerConfig): StripeWebhookHandler {
  return async (rawBody, signature) => {
    let event: Stripe.Event;

    if (config.secret) {
      if (!signature) {
        return { ok: false, status: 400, error: "missing stripe-signature header" };
      }
      try {
        event = config.stripe.webhooks.constructEvent(rawBody, signature, config.secret);
      } catch (err) {
        return {
          ok: false,
          status: 400,
          error: err instanceof Error ? err.message : "signature verification failed",
        };
      }
    } else if (config.allowUnverifiedInDev) {
      console.warn(
        "[@broberg/stripe] STRIPE_WEBHOOK_SECRET unset — parsing webhook WITHOUT signature verification (dev only)",
      );
      try {
        const text = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
        event = JSON.parse(text) as Stripe.Event;
      } catch {
        return { ok: false, status: 400, error: "invalid JSON body" };
      }
    } else {
      return { ok: false, status: 400, error: "webhook secret not configured" };
    }

    try {
      const handler = config.handlers[event.type];
      if (handler) {
        await handler(event);
      } else if (config.onUnhandled) {
        await config.onUnhandled(event);
      }
      return { ok: true, status: 200, event };
    } catch (err) {
      return {
        ok: false,
        status: 500,
        event,
        error: err instanceof Error ? err.message : "webhook handler error",
      };
    }
  };
}

export type { Stripe };

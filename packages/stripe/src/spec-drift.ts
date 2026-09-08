/**
 * F053.12 — ask STRIPE'S OWN PUBLISHED SPEC where the fields live.
 *
 * Christian, 2026-09-08: *"et test miljø er jo en bestemt konto — har Stripe
 * ikke et åbent officielt API til health check?"* He was right, and the answer
 * is better than the account-based probe it replaces as the primary check.
 *
 * Stripe publishes its complete OpenAPI description publicly. No account, no
 * key, no test objects to create and clean up, nothing to leak. Measured
 * 2026-09-08 against spec version `2026-08-26.dahlia`:
 *
 *     subscription.current_period_end        ABSENT   ← F098.4, exactly
 *     subscription_item.current_period_end   PRESENT  ← where it lives now
 *     invoice.subscription                   ABSENT   ← F102, exactly
 *     invoice.parent                         PRESENT  ← where it lives now
 *
 * Both incidents that cost sanneandersen a production outage are visible in one
 * fetch, and would have been visible the day Stripe published the change —
 * possibly before it reached us.
 *
 * WHAT THIS IS NOT. `stripestatus.com` answers whether Stripe is UP. It said
 * "All Systems Operational" throughout both incidents, because Stripe was up
 * both times. Uptime was never the question.
 */

/** The default: Stripe's own repository, raw. Public, no auth. */
export const STRIPE_SPEC_URL =
  "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json";

/**
 * A location one of our readers depends on.
 *
 * `primary` is the location the reader tries FIRST. If it disappears, the
 * reader silently falls through to the deprecated location and keeps working —
 * which is precisely how both incidents stayed invisible until a customer was
 * affected. So a missing primary is DRIFT even though nothing is broken yet.
 *
 * `fallback` is the old location. It is reported, never asserted: Stripe
 * removing a field we no longer read first is not our problem, and asserting it
 * would make the check go red on a change that helps us.
 */
export interface FieldExpectation {
  reader: "readPeriod" | "readSubscriptionId";
  role: "primary" | "fallback";
  schema: string;
  property: string;
}

export const FIELD_EXPECTATIONS: FieldExpectation[] = [
  { reader: "readPeriod", role: "primary", schema: "subscription_item", property: "current_period_end" },
  { reader: "readPeriod", role: "fallback", schema: "subscription", property: "current_period_end" },
  { reader: "readSubscriptionId", role: "primary", schema: "invoice", property: "parent" },
  { reader: "readSubscriptionId", role: "fallback", schema: "invoice", property: "subscription" },
];

export type SpecDriftStatus = "ok" | "drift" | "unknown";

export interface FieldFinding extends FieldExpectation {
  present: boolean;
}

export interface SpecDriftResult {
  status: SpecDriftStatus;
  /** The API version the spec declares, so a result can be pinned to one. */
  specVersion: string | null;
  findings: FieldFinding[];
  /** Only when status is "unknown" — why we could not look. */
  reason?: string;
}

type SpecShape = {
  info?: { version?: unknown };
  components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
};

export interface SpecDriftOptions {
  /** Injected so the check can be tested against a real spec OR a crafted one. */
  fetchSpec?: () => Promise<unknown>;
}

const defaultFetch = async (): Promise<unknown> => {
  const res = await fetch(STRIPE_SPEC_URL);
  if (!res.ok) throw new Error(`spec fetch returned ${res.status}`);
  return res.json();
};

/**
 * Returns rather than throws. This runs on a schedule, and what an incident
 * needs is a status, not a stack trace.
 */
export async function checkSpecDrift(opts: SpecDriftOptions = {}): Promise<SpecDriftResult> {
  let spec: SpecShape;
  try {
    spec = (await (opts.fetchSpec ?? defaultFetch)()) as SpecShape;
  } catch (e) {
    // NOT a verdict about Stripe or about us. Merging this into either
    // direction is how a monitor becomes noise or a lie.
    return {
      status: "unknown",
      specVersion: null,
      findings: [],
      reason: `could not read the Stripe spec: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const schemas = spec?.components?.schemas;
  if (!schemas || typeof schemas !== "object") {
    return {
      status: "unknown",
      specVersion: null,
      findings: [],
      reason: "the document has no components.schemas — it is not the Stripe OpenAPI spec",
    };
  }

  const findings: FieldFinding[] = FIELD_EXPECTATIONS.map((e) => ({
    ...e,
    present: Boolean(schemas[e.schema]?.properties?.[e.property]),
  }));

  // ONLY a missing PRIMARY is drift. A fallback that disappears costs us
  // nothing; asserting it would redden the check on a change in our favour.
  const drifted = findings.some((f) => f.role === "primary" && !f.present);

  const version = spec?.info?.version;
  return {
    status: drifted ? "drift" : "ok",
    specVersion: typeof version === "string" ? version : null,
    findings,
  };
}

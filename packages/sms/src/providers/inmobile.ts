// inMobile — the v4 REST API.
//
// F076.3. Built against their live OpenAPI spec (api.inmobile.com/swagger/v1/swagger.json,
// "inMobile REST API version 4", fetched 2026-08-23).
//
// EACH OF THE THREE GATEWAYS HIDES A FAILED SEND IN A DIFFERENT PLACE, and this
// is the third variety:
//
//   GatewayAPI  a non-2xx.                        res.ok catches it.
//   sms.dk      207 Multi-Status with the number  res.ok does NOT catch it.
//               in a `rejected` array.
//   inMobile    200 OK, a real messageId, and     nothing at the top level
//               numberDetails.isValidMsisdn=false  disagrees at all.
//
// So here the success test is a BOOLEAN NESTED TWO LEVELS DOWN inside an
// otherwise perfectly happy response. An adapter that returns results[0].messageId
// on a 200 reports an undeliverable number as sent, with an id you can quote.
//
// AND THEY TELL US WHAT THEY WILL CHARGE. `smsCount` is their own segment count —
// "Charging will also be done according to this number" — computed by their
// implementation of the same GSM-7 rules ours implements. That is a free
// cross-check between two independent implementations, so we make it: if their
// count disagrees with estimate(), one of us is wrong about the bill and the
// caller should hear about it rather than find out on an invoice.
//
// Sender note: inMobile TRUNCATES an over-long sender instead of rejecting it
// ("If the max length is exceeded, the string is truncated"), and their numeric
// limit is 14 where the other two allow 15. Both handled by checkSenderName.

import { SmsUnknownError, checkSenderName, estimate, type SmsProvider } from '../index';

export interface InMobileConfig {
  /** API key from the inMobile dashboard. Sent as the Basic-auth PASSWORD. */
  apiKey: string;
  /** Escape hatch for a test double or a proxy. */
  baseUrl?: string;
  /**
   * Delivery status callback (F076.5). Their term is statusCallbackUrl.
   * Without it, a messageId is the last thing you ever learn about a message.
   */
  statusCallbackUrl?: string;
  /**
   * If true, a number on the account blacklist is blocked. Defaults to THEIR
   * default rather than ours — an opinion about someone else's opt-out list is
   * not this package's to have.
   */
  respectBlacklist?: boolean;
  /** Message validity, 60..172800 seconds. Theirs if unset. */
  validityPeriodInSeconds?: number;
  timeoutMs?: number;
}

/** inMobile's numeric sender limit is 14, not the 15 the other two allow. */
const SENDER_MAX_NUMERIC_INMOBILE = 14;
const DEFAULT_BASE = 'https://api.inmobile.com';

interface Reply {
  results?: Array<{
    messageId?: unknown;
    smsCount?: unknown;
    encoding?: unknown;
    from?: unknown;
    numberDetails?: { isValidMsisdn?: unknown; msisdn?: unknown; rawMsisdn?: unknown };
  }>;
  errorMessage?: unknown;
  details?: unknown;
}

declare const console: { warn(...args: unknown[]): void };

export function inmobile(config: InMobileConfig): SmsProvider {
  const {
    apiKey,
    baseUrl,
    statusCallbackUrl,
    respectBlacklist,
    validityPeriodInSeconds,
    timeoutMs = 15_000,
  } = config;

  if (!apiKey) {
    throw new Error(
      'inmobile: apiKey is empty. Ship-dark by passing NO provider to createSms() ' +
        '(mode becomes "no-key"); a provider holding an empty key would 401 on every send instead.',
    );
  }

  const root = (baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  const url = `${root}/v4/sms/outgoing`;
  // "Provide Basic Authentication with an arbitrary username and your api key as
  // password" — their words. The username is genuinely ignored.
  // btoa, not Buffer: this package claims to load on edge runtimes, and Buffer is
  // a Node global. An API key is ASCII, so btoa's latin1 restriction is not a
  // constraint here.
  const auth = `Basic ${btoa(`api:${apiKey}`)}`;

  return {
    name: 'inmobile',

    async send({ to, text, from }) {
      const senderProblem = checkSenderName(from, 'inmobile', SENDER_MAX_NUMERIC_INMOBILE);
      if (senderProblem) throw new Error(senderProblem);

      // Their msisdn is a STRING with the country code and no plus.
      const msisdn = to.replace(/^\+/, '');
      const cost = estimate(text);

      const message: Record<string, unknown> = {
        to: msisdn,
        text,
        from,
        // We already computed the encoding to price the message, so declare it
        // rather than using their "auto" and hoping we agree.
        encoding: cost.encoding === 'ucs-2' ? 'ucs2' : 'gsm7',
        countryHint: 'DK',
      };
      if (statusCallbackUrl) message.statusCallbackUrl = statusCallbackUrl;
      if (respectBlacklist !== undefined) message.respectBlacklist = respectBlacklist;
      if (validityPeriodInSeconds !== undefined) message.validityPeriodInSeconds = validityPeriodInSeconds;

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ messages: [message] }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        if (timedOut) {
          throw new SmsUnknownError(
            `inmobile: no response within ${timeoutMs}ms. THE MESSAGE MAY OR MAY NOT HAVE BEEN SENT ` +
              `— and may already have been billed. Do NOT retry blindly; check the report first.`,
          );
        }
        throw new SmsUnknownError(
          `inmobile: could not reach ${url} — ${err instanceof Error ? err.message : String(err)}. ` +
            `The request may still have arrived; do NOT retry blindly.`,
        );
      }

      const raw = await res.text();
      let parsed: Reply;
      try {
        parsed = JSON.parse(raw) as Reply;
      } catch {
        // An unreadable body only means "we do not know" when they ACCEPTED it.
        // On a 4xx/5xx we heard a no, and a no is safe to retry.
        throw res.ok
          ? new SmsUnknownError(
              `inmobile: accepted with ${res.status} but the body was not JSON, so we cannot tell what was ` +
                `sent — do NOT retry blindly: ${raw.slice(0, 200)}`,
            )
          : new Error(`inmobile: ${res.status} but the body was not JSON: ${raw.slice(0, 200)}`);
      }

      if (!res.ok) {
        const msg = typeof parsed.errorMessage === 'string' ? parsed.errorMessage : raw.slice(0, 300);
        const details = Array.isArray(parsed.details) ? ` (${parsed.details.join('; ')})` : '';
        const hint =
          res.status === 401
            ? ' — the API key was rejected. It is sent as the Basic-auth PASSWORD, with the username ignored.'
            : '';
        throw new Error(`inmobile ${res.status}${hint}: ${msg}${details}`);
      }

      const result = parsed.results?.[0];
      if (!result) {
        throw new SmsUnknownError(
          `inmobile: ${res.status} but the results array was empty — they accepted the request and told us ` +
            `nothing about it. Do NOT retry blindly: ${raw.slice(0, 200)}`,
        );
      }

      // THE ONE THAT MATTERS. A 200 with a real messageId and isValidMsisdn:false
      // is a number they could not use. Nothing else in the response says so.
      if (result.numberDetails?.isValidMsisdn === false) {
        const rawMsisdn = result.numberDetails?.rawMsisdn;
        throw new Error(
          `inmobile: they accepted the request and marked the number INVALID — isValidMsisdn=false for ` +
            `${JSON.stringify(rawMsisdn ?? msisdn)}. This is a 200 with a messageId; it is NOT a message that will arrive.`,
        );
      }

      // Their charge count vs ours. Two independent implementations of the same
      // GSM-7 rules; a disagreement means somebody is wrong about the invoice.
      if (typeof result.smsCount === 'number' && result.smsCount !== cost.segments) {
        console.warn(
          `[@broberg/sms] inmobile will charge for ${result.smsCount} segment(s); estimate() predicted ` +
            `${cost.segments} (${cost.units} units, ${cost.encoding}). One of the two is wrong about the bill.`,
        );
      }

      const id = typeof result.messageId === 'string' ? result.messageId : undefined;
      if (!id) {
        throw new SmsUnknownError(
          `inmobile: ${res.status} but no messageId was returned, so there is no handle for the delivery ` +
            `report — the message was probably sent. Do NOT retry blindly: ${raw.slice(0, 200)}`,
        );
      }
      return { id };
    },
  };
}

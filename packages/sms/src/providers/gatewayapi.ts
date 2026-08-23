// GatewayAPI — the Mobile Messaging API.
//
// F076.2. Built against the live OpenAPI spec (version 2026.08.21-1807, fetched
// 2026-08-23), NOT against recalled knowledge — and that mattered three times:
//
// 1. THE API IN EVERY EXAMPLE IS DEPRECATED. `POST /rest/mtsms` on gatewayapi.com
//    now lives under /docs/apis/LEGACY/rest/ and its own page opens with a
//    deprecation warning telling new customers to use this API instead. We are a
//    new customer. An adapter written from memory would have been born retired.
//
// 2. SUCCESS IS 202, NOT 200. The prose shows a success body without a status
//    code and the legacy API answered 200, so `if (res.status !== 200) throw`
//    reads like the obvious check and would fail EVERY successful send.
//
// 3. `recipient` IS AN INTEGER, not a string, and carries no `+`. normalisePhone()
//    hands us E.164 (`+4512345678`), so stripping the plus is this adapter's job.
//
// And one thing the docs do not say, measured against the live endpoint on
// 2026-08-23: no Authorization header answers 401, a WRONG token answers 403.
// The docs list only 403 for authentication. Collapsing the two sends you off to
// regenerate a perfectly good key when the real fault is a header you never set.

import {
  SmsUnknownError,
  checkSenderName,
  gatewayRefusal,
  type BatchOutcome,
  type SmsProvider,
  type SmsSendInput,
} from '../index';

export interface GatewayApiConfig {
  /** Token from the GatewayAPI dashboard. Bound to ONE region — see `region`. */
  apiKey: string;
  /**
   * Which platform the account lives on. Default 'eu'.
   *
   * This is not a URL preference. A key is issued by, and valid for, ONE of the
   * two dashboards, so the region decides where the account — and the message
   * data — lives. 'eu' is the default because EU hosting is the reason this
   * package exists (F076: Danish/EU gateways only, phone numbers are personal
   * data). Picking the wrong one does not degrade: the key simply 403s.
   */
  region?: 'eu' | 'com';
  /** Escape hatch for a test double or a proxy. Overrides `region`. */
  baseUrl?: string;
  /**
   * 'urgent' activates "SMS PLUS" for 2FA-style traffic and MAY BE PRICED HIGHER
   * depending on account configuration. Opt in per client, deliberately, because
   * this package exists so money is never spent by accident.
   */
  priority?: 'normal' | 'urgent';
  /** Client-defined label for grouped usage statistics. Reporting only. */
  label?: string;
  /**
   * How long the message stays valid for delivery. ISO-8601 duration.
   * Default (theirs) P5D, which is also the maximum.
   */
  expiration?: string;
  /**
   * Abort after this many ms. A hung request is worse than a failed one — but
   * read the error text: a timeout does NOT mean the message was not sent.
   */
  timeoutMs?: number;
}

const HOSTS = {
  eu: 'https://messaging.gatewayapi.eu',
  com: 'https://messaging.gatewayapi.com',
} as const;

/**
 * Recipients per /mobile/multi call. MEASURED, not guessed: their live OpenAPI
 * gives `messages` `"maxItems": 1000, "minItems": 1`.
 *
 * WORTH WRITING DOWN BECAUSE IT IS TWO DIFFERENT 1000s. The same spec puts
 * `"gt": 1000` on `recipient` — and that one is a floor on the PHONE NUMBER as
 * an integer, not a batch size. Reading it as the batch limit is an easy and
 * completely silent mistake: both numbers are 1000, and only one of them splits
 * your send correctly.
 */
const BATCH_LIMIT = 1000;



export function gatewayapi(config: GatewayApiConfig): SmsProvider {
  const { apiKey, region = 'eu', baseUrl, priority, label, expiration, timeoutMs = 15_000 } = config;

  if (!apiKey) {
    throw new Error(
      'gatewayapi: apiKey is empty. Ship-dark by passing NO provider to createSms() ' +
        '(mode becomes "no-key"); a provider holding an empty key would 401 on every send instead.',
    );
  }

  const root = (baseUrl ?? HOSTS[region]).replace(/\/+$/, '');
  const url = `${root}/mobile/single`;
  const multiUrl = `${root}/mobile/multi`;

  /**
   * POST and read the body, with the ONE rule this package will not bend: a
   * request whose answer never arrived is `unknown`, not failed.
   *
   * Shared by both paths deliberately. Two copies of this classification is two
   * chances to get the expensive direction wrong, and the batch path is where it
   * would be expensive a thousand times over.
   */
  const request = async (
    target: string,
    body: unknown,
    count: number,
  ): Promise<{ res: Response; raw: string }> => {
    const subject = count === 1 ? 'THE MESSAGE' : `ALL ${count} MESSAGES`;
    let res: Response;
    try {
      res = await fetch(target, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      if (timedOut) {
        // NOT the same as "it failed". The request may have reached them and the
        // message may already be sent AND BILLED — we simply never heard the
        // answer. Retrying blind double-sends and double-charges.
        throw new SmsUnknownError(
          `gatewayapi: no response within ${timeoutMs}ms. ${subject} MAY OR MAY NOT HAVE BEEN SENT ` +
            `— and may already have been billed. Do NOT retry blindly; confirm via delivery status first.`,
        );
      }
      // Also unknown: a socket that dies mid-request looks identical to one that
      // never opened, and only one of those is safe to retry.
      throw new SmsUnknownError(
        `gatewayapi: could not reach ${target} — ${err instanceof Error ? err.message : String(err)}. ` +
          `The request may still have arrived; do NOT retry blindly.`,
      );
    }
    return { res, raw: await res.text() };
  };

  /** The per-message body, or the reason this one recipient cannot be sent. */
  const toRequest = ({ to, text, from }: SmsSendInput): { ok: true; body: Record<string, unknown>; recipient: number } | { ok: false; error: Error } => {
    // Caught here rather than by their 422, because a sender name is set ONCE in
    // config and would otherwise fail on every message forever.
    const senderProblem = checkSenderName(from, 'gatewayapi');
    if (senderProblem) return { ok: false, error: new Error(senderProblem) };

    // E.164 in, bare digits out. Every E.164 number is at most 15 digits, so
    // this always stays inside Number.MAX_SAFE_INTEGER (~9.0e15).
    const recipient = Number(to.replace(/^\+/, ''));
    if (!Number.isSafeInteger(recipient)) {
      return { ok: false, error: new Error(`gatewayapi: ${JSON.stringify(to)} is not a usable recipient number.`) };
    }

    const body: Record<string, unknown> = { sender: from, recipient, message: text };
    if (priority) body.priority = priority;
    if (label) body.label = label;
    if (expiration) body.expiration = expiration;
    return { ok: true, body, recipient };
  };

  const statusHint = (status: number): string =>
    status === 401
      ? ' — NO credentials reached them. The Authorization header is missing or malformed; it must read exactly "Token <key>". Your key is probably fine.'
      : status === 403
        ? ' — credentials arrived and were REJECTED. Wrong/revoked key, or a key issued for the OTHER region (this client is pointed at ' +
          `${root}). Check which dashboard minted it.`
        : status === 422
          ? ' — they parsed it and refused the contents (recipient not a phone number, empty message, bad sender, or an expiration out of range). The body below names the field.'
          : '';

  return {
    name: `gatewayapi:${baseUrl ? 'custom' : region}`,
    batchLimit: BATCH_LIMIT,

    async send({ to, text, from }) {
      // Shared with the sms.dk adapter: both gateways state the same sender
      // limit, so it is the SMS standard rather than a GatewayAPI quirk. Their
      // OWN schema permits 18, which is the trap — see checkSenderName.
      const built = toRequest({ to, text, from });
      if (!built.ok) throw built.error;

      const { res, raw } = await request(url, built.body, 1);

      if (!res.ok) {
        // 401 and 403 are different faults with different fixes. Their docs list
        // only 403; the live API distinguishes them, so we do too.
        // 429 and 5xx come back branded retryable (F076.11); a 401/403/422 does not,
        // because it will refuse exactly the same way on attempt five.
        throw gatewayRefusal(
          res.status,
          `gatewayapi ${res.status}${statusHint(res.status)} ${raw.slice(0, 500)}`.trim(),
          res.headers,
        );
      }

      // Success is 202 Accepted, not 200 — hence res.ok rather than a status test.
      let parsed: { msg_id?: unknown };
      try {
        parsed = JSON.parse(raw) as { msg_id?: unknown };
      } catch {
        // They ACCEPTED it (2xx) and we cannot read the handle. The message is
        // probably on its way; retrying would send a second one.
        throw new SmsUnknownError(
          `gatewayapi: accepted with ${res.status} but the body was not JSON, so we have no msg_id — ` +
            `the message was probably sent. Do NOT retry blindly: ${raw.slice(0, 200)}`,
        );
      }

      const id = typeof parsed.msg_id === 'string' ? parsed.msg_id : undefined;
      if (!id) {
        // Their schema marks msg_id required. If it is absent we have no handle
        // for the delivery webhook, so say so rather than returning a blank id.
        throw new SmsUnknownError(
          `gatewayapi: accepted with ${res.status} but returned no msg_id, so there is no handle for the ` +
            `delivery webhook — the message was probably sent. Do NOT retry blindly: ${raw.slice(0, 200)}`,
        );
      }
      return { id };
    },

    /**
     * One HTTP call, up to 1000 recipients — POST /mobile/multi.
     *
     * TWO THINGS HERE THAT A CAREFUL READING OF THEIR DOCS GETS WRONG.
     *
     * 1. THE DOCUMENTED EXAMPLE IS THE WRONG SHAPE. Their 202 example for
     *    /mobile/multi shows a single `{msg_id, recipient, reference}` — the
     *    response for the SINGLE route — while the schema it references,
     *    MultiMobileMessageResponse, is `{responses: [...]}`. Coding to the
     *    example reads `undefined` for every recipient of every batch, and does
     *    it silently: the messages went, the ids did not come back.
     *
     * 2. AN ID MUST NEVER BE ATTRIBUTED TO THE WRONG NUMBER. Trusting array
     *    order alone means a reordered response writes recipient A's delivery
     *    status against recipient B — and nothing downstream can detect it,
     *    because both ids are real. They echo `recipient` back on every answer,
     *    so we match on it and CONSUME each answer once. An unmatched recipient
     *    is reported `unknown`, never guessed.
     */
    async sendMany(messages: SmsSendInput[]): Promise<BatchOutcome[]> {
      const outcomes = new Array<BatchOutcome>(messages.length);
      const live: Array<{ index: number; recipient: number; body: Record<string, unknown> }> = [];

      // One bad sender name or unusable number does NOT take the batch with it.
      messages.forEach((m, index) => {
        const built = toRequest(m);
        if (built.ok) live.push({ index, recipient: built.recipient, body: built.body });
        else outcomes[index] = built;
      });

      // Everybody in this chunk was refused locally: no HTTP call, nothing billed.
      if (!live.length) return outcomes;

      const { res, raw } = await request(multiUrl, { messages: live.map((e) => e.body) }, live.length);

      if (!res.ok) {
        // The WHOLE request was refused, so nothing in it was accepted. Thrown
        // rather than filled in per recipient, which lets a 429/5xx stay branded
        // retryable and the chunk be tried again as a whole.
        throw gatewayRefusal(
          res.status,
          `gatewayapi ${res.status}${statusHint(res.status)} ${raw.slice(0, 500)}`.trim(),
          res.headers,
        );
      }

      let parsed: { responses?: unknown };
      try {
        parsed = JSON.parse(raw) as { responses?: unknown };
      } catch {
        throw new SmsUnknownError(
          `gatewayapi: accepted ${live.length} message(s) with ${res.status} but the body was not JSON, so we ` +
            `have no ids — they were probably sent. Do NOT retry blindly: ${raw.slice(0, 200)}`,
        );
      }

      const responses = Array.isArray(parsed.responses)
        ? (parsed.responses as Array<{ msg_id?: unknown; recipient?: unknown }>)
        : null;
      if (!responses) {
        throw new SmsUnknownError(
          `gatewayapi: accepted ${live.length} message(s) with ${res.status} but the reply had no \`responses\` ` +
            `array, so we have no ids — they were probably sent. Do NOT retry blindly: ${raw.slice(0, 200)}`,
        );
      }

      const used = new Array<boolean>(responses.length).fill(false);
      /** Same ordinal if it is for the same number; otherwise search; else null. */
      const take = (ordinal: number, recipient: number): { msg_id?: unknown } | null => {
        const atOrdinal = responses[ordinal];
        if (atOrdinal && !used[ordinal] && Number(atOrdinal.recipient) === recipient) {
          used[ordinal] = true;
          return atOrdinal;
        }
        for (let i = 0; i < responses.length; i += 1) {
          if (!used[i] && Number(responses[i].recipient) === recipient) {
            used[i] = true;
            return responses[i];
          }
        }
        return null;
      };

      live.forEach((entry, ordinal) => {
        const hit = take(ordinal, entry.recipient);
        if (!hit) {
          outcomes[entry.index] = {
            ok: false,
            error: new SmsUnknownError(
              `gatewayapi: accepted with ${res.status} but returned no answer for ${entry.recipient} ` +
                `(${responses.length} answer(s) for ${live.length} message(s)). It may still have been sent — ` +
                `do NOT retry blindly.`,
            ),
          };
          return;
        }
        const msgId = typeof hit.msg_id === 'string' ? hit.msg_id : undefined;
        outcomes[entry.index] = msgId
          ? { ok: true, id: msgId }
          : {
              ok: false,
              error: new SmsUnknownError(
                `gatewayapi: accepted with ${res.status} but returned no msg_id for ${entry.recipient}, so there ` +
                  `is no handle for the delivery webhook — it was probably sent. Do NOT retry blindly.`,
              ),
            };
      });

      return outcomes;
    },
  };
}

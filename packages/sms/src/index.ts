// @broberg/sms — one send primitive, any Danish gateway behind it.
//
// F076. Requested by Christian 2026-08-22: an SMS module where the provider is
// a choice, not a rewrite. Danish / EU-hosted gateways only — a phone number is
// personal data, and SMS bodies routinely carry one-time codes and appointment
// details, so provider selection is part of the spec rather than an ops detail.
//
// TWO THINGS COST MONEY HERE THAT DO NOT EXIST IN EMAIL, and both are silent.
//
// 1. ENCODING FLIPS THE PRICE. GSM-7 gives 160 characters per message. ONE
//    character outside it — a curly apostrophe pasted from Word, an emoji, a
//    non-breaking space — flips the WHOLE message to UCS-2 at 70. A 155-char
//    message becomes THREE parts: triple price, no warning, no error, and it
//    still arrives looking perfect. Danish æøå are in GSM-7, which makes this
//    worse rather than better — everything looks fine until someone pastes a
//    quote mark. Hence estimate(): ask what it costs BEFORE paying for it.
//
// 2. A MALFORMED NUMBER IS BILLED, NOT REJECTED. +45 / 45 / bare 8 digits /
//    spaces / parentheses all reach a gateway, and most accept and charge for
//    what they cannot deliver. The failure is silence — there is no bounce.
//
// And the form this repo has fought all week, harder here: a provider saying
// "accepted" is not "delivered to a handset", and every one of those costs
// money. Delivery status is F076.5 and is not optional.
//
// Shape deliberately copied from @broberg/mail, which is proven and which the
// fleet already reads. Zero runtime dependencies, fetch only, so it loads on
// Node, Bun and edge alike.

/** GSM 03.38 default alphabet — every character here is ONE septet. */
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);

/**
 * GSM 03.38 extension table. Each of these is still GSM-7 — but costs TWO
 * septets, because it is sent as an escape plus the character. Eighty of them
 * is two messages, not one. Missing this under-counts a bill without ever
 * looking wrong.
 */
const GSM7_EXTENDED = new Set(['\f', '^', '{', '}', '\\', '[', '~', ']', '|', '€']);

/** Single message. */
const GSM7_SINGLE = 160;
const UCS2_SINGLE = 70;
/**
 * Concatenated messages spend 7 bytes per part on the UDH header that stitches
 * them together — so a long message gets 153/67 per part, NOT 160/70. Using
 * the single-message figures here under-counts every long message and
 * under-reports every invoice.
 */
const GSM7_MULTIPART = 153;
const UCS2_MULTIPART = 67;

export type SmsEncoding = 'gsm-7' | 'ucs-2';

export interface SmsEstimate {
  /** Billable units. UCS-2 counts UTF-16 code units, so an emoji costs 2. */
  units: number;
  segments: number;
  encoding: SmsEncoding;
  /** Present when the message costs more than the sender probably expects. */
  warning?: string;
}

/**
 * What will this message actually cost, before you send it?
 *
 * The single most useful function in this package. A message is priced per
 * SEGMENT, and the segment count is not a property of how long the text looks —
 * it is a property of which characters are in it.
 */
export function estimate(text: string): SmsEstimate {
  let units = 0;
  let encoding: SmsEncoding = 'gsm-7';
  let culprit: string | undefined;

  for (const ch of text) {
    if (GSM7_BASIC.has(ch)) {
      units += 1;
    } else if (GSM7_EXTENDED.has(ch)) {
      units += 2;
    } else {
      encoding = 'ucs-2';
      culprit ??= ch;
      break;
    }
  }

  if (encoding === 'ucs-2') {
    // UTF-16 code units: a surrogate pair (most emoji) is legitimately 2.
    units = text.length;
  }

  const single = encoding === 'gsm-7' ? GSM7_SINGLE : UCS2_SINGLE;
  const multi = encoding === 'gsm-7' ? GSM7_MULTIPART : UCS2_MULTIPART;
  const segments = units <= single ? 1 : Math.ceil(units / multi);

  let warning: string | undefined;
  if (encoding === 'ucs-2') {
    const asGsm = Math.max(1, Math.ceil(text.length / GSM7_SINGLE));
    warning =
      `${JSON.stringify(culprit)} is not in GSM-7, so the WHOLE message is billed as UCS-2 ` +
      `(70 chars per part instead of 160). This costs ${segments} segment(s) ` +
      `instead of about ${asGsm}. Replacing that one character is usually the whole fix.`;
  } else if (segments > 1) {
    warning = `${units} characters — billed as ${segments} segments (${GSM7_MULTIPART} per part once a message is split).`;
  }

  return { units, segments, encoding, ...(warning ? { warning } : {}) };
}

/**
 * Normalise a phone number to E.164, or REFUSE it.
 *
 * Refusing matters more than accepting: a guessed number is accepted by the
 * gateway, billed, and never delivered — and nothing in the chain reports it.
 * So anything ambiguous throws rather than resolving to a plausible number.
 */
export function normalisePhone(input: string, defaultCountry = '45'): string {
  const raw = (input ?? '').trim();
  if (!raw) throw new Error('normalisePhone: empty input.');

  // Strip the punctuation people really type: spaces, dashes, dots, parens.
  let s = raw.replace(/[\s().‐-―-]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;

  const plus = s.startsWith('+');
  const digits = plus ? s.slice(1) : s;

  if (!/^\d+$/.test(digits)) {
    throw new Error(`normalisePhone: ${JSON.stringify(input)} contains characters that are not part of a phone number.`);
  }

  if (plus) {
    if (digits.length < 8 || digits.length > 15) {
      throw new Error(`normalisePhone: ${JSON.stringify(input)} is not a plausible E.164 number (${digits.length} digits).`);
    }
    return `+${digits}`;
  }

  // A bare national number: 8 digits in DK. Deliberately narrow — widening this
  // to "any short-enough run of digits" is how a truncated number gets sent.
  if (digits.length === 8) return `+${defaultCountry}${digits}`;

  // Already carries the country code but lost its plus (4512345678).
  if (digits.startsWith(defaultCountry) && digits.length === defaultCountry.length + 8) {
    return `+${digits}`;
  }

  throw new Error(
    `normalisePhone: cannot resolve ${JSON.stringify(input)} unambiguously — ` +
      `pass it in E.164 form (+45…). Guessing here produces a number that is billed and never delivered.`,
  );
}

/**
 * Sender-name limits, from the SMS standard rather than from any one provider.
 *
 * CONFIRMED INDEPENDENTLY BY TWO GATEWAYS, which is why it lives here and not in
 * an adapter:
 *   GatewayAPI — "15 digits, or up to 11 characters if it is text", and a sender
 *                that does not fit "may be replaced automatically" en route.
 *   sms.dk     — "either numeric with a limit of 15 chars or alphanumeric with a
 *                limit of 11 chars".
 *
 *   inMobile   — "a 3-11 chars text sender or an up to 14 digit long sender
 *                number", and — worse than a rejection — "IF THE MAX LENGTH IS
 *                EXCEEDED, THE STRING IS TRUNCATED".
 *
 * The TEXT limit of 11 is unanimous, so it lives here as a constant. The NUMERIC
 * limit is not: 15 on GatewayAPI and sms.dk, 14 on inMobile, which is why
 * checkSenderName takes it as a parameter rather than assuming.
 *
 * Note GatewayAPI's own OpenAPI schema permits 18. It is the network, not the
 * API, that decides what actually arrives — so a name their validator accepts
 * can still be replaced silently on the way to the handset, and inMobile will
 * quietly cut it down without telling anyone. Three vendors, three flavours of
 * the same silent failure; one check in front of all of them.
 */
export const SENDER_MIN = 3;
export const SENDER_MAX_TEXT = 11;
export const SENDER_MAX_NUMERIC = 15;

/**
 * Returns an explanation if the sender name will not survive, or null if it is
 * fine. Checked once at send time rather than left to the provider, because a
 * sender name is set ONCE in config: getting it wrong fails every message
 * forever, and on at least one gateway it fails INVISIBLY.
 */
export function checkSenderName(from: string, provider: string, maxNumeric = SENDER_MAX_NUMERIC): string | null {
  const numeric = /^\d+$/.test(from);
  const max = numeric ? maxNumeric : SENDER_MAX_TEXT;
  if (from.length >= SENDER_MIN && from.length <= max) return null;
  return (
    `${provider}: sender ${JSON.stringify(from)} is ${from.length} characters — ` +
    `a ${numeric ? 'numeric' : 'text'} sender must be ${SENDER_MIN}\u2013${max}. ` +
    (numeric
      ? 'Nothing was sent.'
      : 'The SMS standard only carries 11 for a text sender, so a longer one is REPLACED ' +
        'by the network and arrives showing something else — even where the API accepts it. Nothing was sent.')
  );
}

export interface SmsMessage {
  to: string;
  text: string;
  /** Sender name or number. Falls back to the client's `from`. */
  from?: string;
}

/**
 * What actually happened to a send. FOUR outcomes, because there are four —
 * and `ok: boolean` can only carry two.
 *
 * The one that matters is `unknown`. When a request times out, or the socket
 * dies, or the gateway answers 2xx with a body we cannot read, we do not know
 * what happened: the message may have reached them, may already be on its way
 * to a handset, and MAY ALREADY BE BILLED. We simply never heard the answer.
 *
 * Collapsed into `ok:false`, that is indistinguishable from a rejected key —
 * and the obvious response to `ok:false` is to retry. A retry after an unknown
 * double-sends and double-charges, and on a one-time code it sends the user two
 * different codes, of which only one works.
 *
 * The same shape @broberg/mail hit in F005.9: three states squeezed into two.
 *
 * THE RULE, and it fits on one line:
 *   `refused` means the gateway told us no. Anything else that is not a
 *   confirmed send is `unknown`.
 *
 * So retry on `refused`. NEVER retry on `unknown` — confirm via delivery status
 * (F076.5) first, or send with an idempotency key the gateway honours.
 */
export type SmsOutcome = 'sent' | 'skipped' | 'refused' | 'unknown';

/**
 * Thrown by an adapter when the outcome of a send is genuinely unknown.
 *
 * The core branches on the BRAND (`smsOutcome`), never on `instanceof` and
 * never on the message text. instanceof breaks the moment two copies of this
 * package end up in one bundle — a real and quiet failure, and it would fail in
 * the expensive direction: an unknown silently downgraded to a refusal, which
 * is the retry a caller must not make.
 */
export class SmsUnknownError extends Error {
  readonly smsOutcome = 'unknown' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SmsUnknownError';
  }
}

/** True when this error means "we never heard the answer". */
export function isUnknownSendError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { smsOutcome?: unknown }).smsOutcome === 'unknown';
}

export interface SmsResult {
  /**
   * Success. `false` covers BOTH a refusal and an unknown — deliberately, so
   * an existing `if (!res.ok)` alarm still fires on an unknown. Read `outcome`
   * before you retry.
   */
  ok: boolean;
  /** Which of the four things happened. `ok` alone cannot say. */
  outcome: SmsOutcome;
  /** Provider message id — the same id a delivery status will carry back (F076.5). */
  id?: string;
  error?: string;
  /** True when the client deliberately did NOT send (dark, disabled, not allowlisted). */
  skipped?: boolean;
  /** What it cost, or would have cost. Present even when skipped. */
  estimate?: SmsEstimate;
}

/** What an adapter must implement. Deliberately tiny — one method, one shape. */
export interface SmsProvider {
  readonly name: string;
  send(message: { to: string; text: string; from: string }): Promise<{ id?: string }>;
}

export type DeliveryMode = 'live' | 'allowlist-only' | 'disabled' | 'no-key';

export interface SmsConfig {
  provider?: SmsProvider;
  from: string;
  /**
   * EXPLICIT opt-in, never inferred from "we have a provider". @broberg/mail
   * learned this the expensive way: defaulting live to !!apiKey mass-sent to
   * real users from staging in two repos. Here it would also spend money.
   */
  live?: boolean;
  disabled?: boolean;
  /** Numbers that receive mail even when not live. Normalised on construction. */
  allowlist?: string[];
  defaultCountry?: string;
}

export interface SmsClient {
  /** The resolved delivery decision — assert this at boot. */
  readonly mode: DeliveryMode;
  readonly provider: string | null;
  estimate(text: string): SmsEstimate;
  send(message: SmsMessage): Promise<SmsResult>;
}

declare const console: { warn(...args: unknown[]): void };

export function createSms(config: SmsConfig): SmsClient {
  const {
    provider = null,
    from,
    live = false,
    disabled = false,
    allowlist = [],
    defaultCountry = '45',
  } = config;

  // Precedence mirrors what send() actually does, so the readback describes the
  // observable outcome rather than restating the config: a missing provider
  // beats live:true, and disabled beats everything.
  const mode: DeliveryMode = disabled ? 'disabled' : !provider ? 'no-key' : live ? 'live' : 'allowlist-only';

  const allowed = new Set(
    allowlist.map((n) => {
      try {
        return normalisePhone(n, defaultCountry);
      } catch {
        // An unparseable allowlist entry must not silently widen the gate.
        console.warn(`[@broberg/sms] allowlist entry ${JSON.stringify(n)} is not a usable number — ignored.`);
        return '';
      }
    }),
  );
  allowed.delete('');

  return {
    mode,
    provider: provider?.name ?? null,
    estimate,

    async send(message: SmsMessage): Promise<SmsResult> {
      let to: string;
      try {
        to = normalisePhone(message.to, defaultCountry);
      } catch (err) {
        // Local refusal — nothing left this process, nothing was billed.
        return { ok: false, outcome: 'refused', error: err instanceof Error ? err.message : String(err) };
      }

      const cost = estimate(message.text);

      if (mode !== 'live' && !allowed.has(to)) {
        return { ok: true, outcome: 'skipped', skipped: true, estimate: cost };
      }
      if (!provider) {
        return { ok: true, outcome: 'skipped', skipped: true, estimate: cost };
      }

      try {
        const res = await provider.send({ to, text: message.text, from: message.from ?? from });
        return { ok: true, outcome: 'sent', ...(res.id ? { id: res.id } : {}), estimate: cost };
      } catch (err) {
        // The whole point of this card: an adapter that never heard an answer
        // says so with a BRANDED error, and it lands here as its own outcome
        // rather than as another `ok:false` a retry wrapper cannot tell apart.
        return {
          ok: false,
          outcome: isUnknownSendError(err) ? 'unknown' : 'refused',
          error: err instanceof Error ? err.message : String(err),
          estimate: cost,
        };
      }
    },
  };
}

export { gatewayapi, type GatewayApiConfig } from './providers/gatewayapi';
export { smsdk, type SmsDkConfig } from './providers/smsdk';
export { inmobile, type InMobileConfig } from './providers/inmobile';
export * from './delivery';

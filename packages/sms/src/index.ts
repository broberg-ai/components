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

export interface SmsMessage {
  to: string;
  text: string;
  /** Sender name or number. Falls back to the client's `from`. */
  from?: string;
}

export interface SmsResult {
  ok: boolean;
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
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      const cost = estimate(message.text);

      if (mode !== 'live' && !allowed.has(to)) {
        return { ok: true, skipped: true, estimate: cost };
      }
      if (!provider) {
        return { ok: true, skipped: true, estimate: cost };
      }

      try {
        const res = await provider.send({ to, text: message.text, from: message.from ?? from });
        return { ok: true, ...(res.id ? { id: res.id } : {}), estimate: cost };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), estimate: cost };
      }
    },
  };
}

export { gatewayapi, type GatewayApiConfig } from './providers/gatewayapi';

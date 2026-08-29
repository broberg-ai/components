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

import type { ConsentMode, ConsentRegistry, SmsCategory } from './consent';
import { attemptSend, resolveRetry, type RetryConfig, type RetryPolicy } from './retry';
import {
  chunk,
  runPool,
  DEFAULT_CONCURRENCY,
  type BatchOutcome,
  type BatchPlan,
  type SendManyOptions,
} from './batch';
import {
  createDuplicateGuard,
  type DuplicateGuardConfig,
  type DuplicateGuardMode,
  type SmsSkipReason,
} from './lock';

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

/** What a whole batch will cost, before any of it is paid for. */
export interface SmsBatchEstimate {
  messages: number;
  /** Billable segments across the batch — this is the number on the invoice. */
  segments: number;
  units: number;
  /** How many messages landed in each encoding. A stray UCS-2 count is the alarm. */
  encodings: Record<SmsEncoding, number>;
  /** Per-message warnings, each carrying the index that produced it. */
  warnings: Array<{ index: number; warning: string }>;
}

/**
 * Price a whole batch BEFORE sending it (F076.12).
 *
 * Exactly the sum of the per-message estimates — a test asserts that, because a
 * batch estimate that quietly disagrees with the individual ones is worse than
 * no estimate at all: it is a number someone will budget against.
 *
 * The `encodings` split is the part worth looking at. One curly apostrophe in a
 * template used for 5,000 recipients is 5,000 messages billed at UCS-2 rates,
 * and the total alone will not tell you — 5,000 two-segment messages look like
 * a big send, not like a mistake.
 */
export function estimateMany(messages: ReadonlyArray<string | { text: string }>): SmsBatchEstimate {
  const encodings: Record<SmsEncoding, number> = { 'gsm-7': 0, 'ucs-2': 0 };
  const warnings: Array<{ index: number; warning: string }> = [];
  let segments = 0;
  let units = 0;

  messages.forEach((m, index) => {
    const one = estimate(typeof m === 'string' ? m : m.text);
    segments += one.segments;
    units += one.units;
    encodings[one.encoding] += 1;
    if (one.warning) warnings.push({ index, warning: one.warning });
  });

  return { messages: messages.length, segments, units, encodings, warnings };
}

/**
 * F076.13 — the POSTCONDITION, and it is deliberately separate from the input
 * validation above.
 *
 * The input guard proves what I anticipated; this proves the PROPERTY. It is
 * fd-sundhed's third suggestion and the one that generalises: whatever this
 * function returns is a plus followed by digits, or it does not return. It
 * catches all four reported cases on its own, and anything neither of us
 * thought of.
 *
 * IT CANNOT BE TRIGGERED TODAY, and that is stated rather than hidden. With the
 * dialling code validated to 1-3 digits and the number validated to /^\d+$/,
 * every path here builds a plus followed by digits, so no input reaches this
 * throw. The mutation pass says so exactly:
 *
 *   remove the INPUT guard, keep this   -> 9 tests red   (this carries the load)
 *   remove THIS, keep the input guard   -> nothing red   (unreachable today)
 *
 * So it is defence in depth against a future edit above it, not a second check
 * of the same thing. The first line is the proof it works; the second is the
 * honest reason it looks redundant.
 */
function e164(out: string, input: string): string {
  if (!/^\+\d+$/.test(out)) {
    throw new Error(
      `normalisePhone: refusing to return ${JSON.stringify(out)} for input ${JSON.stringify(input)} — ` +
        `it is not a plus followed by digits. This is a bug in normalisePhone, not in your input.`,
    );
  }
  return out;
}

/**
 * Normalise a phone number to E.164, or REFUSE it.
 *
 * Refusing matters more than accepting: a guessed number is accepted by the
 * gateway, billed, and never delivered — and nothing in the chain reports it.
 * So anything ambiguous throws rather than resolving to a plausible number.
 *
 * F076.13 — THE SECOND ARGUMENT IS A DIALLING CODE, NOT A COUNTRY.
 *
 * It used to be called `defaultCountry`, and an ISO code is exactly what a
 * reader writes when they see that name. Nothing validated it, so it went
 * straight into the string. Reported by fd-sundhed against 0.11.0:
 *
 *   normalisePhone('22680880', 'DK')  ->  '+DK22680880'   and no error
 *   normalisePhone('22680880', '+45') ->  '++4522680880'
 *
 * Which is the exact number this function exists to refuse — produced by the
 * function itself. It does not fail: it looks like a phone number, a gateway
 * accepts it, it is BILLED, and it is never delivered.
 *
 * There is no ISO lookup table on purpose. A table goes stale, and the
 * invitation to write 'DK' came from the NAME — remove the invitation and the
 * table is unnecessary. A caller passing 'DK' has made a programmer error, not
 * entered bad user input, so it throws.
 */
export function normalisePhone(input: string, defaultDiallingCode = '45'): string {
  const raw = (input ?? '').trim();
  if (!raw) throw new Error('normalisePhone: empty input.');

  // One leading '+' is unambiguous and used to produce '++45…'. Accepting it
  // costs a line and removes a second way to hold this wrong.
  const cc = String(defaultDiallingCode ?? '').trim().replace(/^\+/, '');
  if (!/^\d{1,3}$/.test(cc)) {
    throw new Error(
      `normalisePhone: ${JSON.stringify(defaultDiallingCode)} is not a dialling code. ` +
        `Pass the digits without a plus — '45' for Denmark, not 'DK'. ` +
        `Left unchecked this returns something like '+DK22680880', which a gateway accepts and bills and never delivers.`,
    );
  }

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
    return e164(`+${digits}`, input);
  }

  // A bare national number: 8 digits in DK. Deliberately narrow — widening this
  // to "any short-enough run of digits" is how a truncated number gets sent.
  if (digits.length === 8) return e164(`+${cc}${digits}`, input);

  // Already carries the country code but lost its plus (4512345678).
  if (digits.startsWith(cc) && digits.length === cc.length + 8) {
    return e164(`+${digits}`, input);
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
  /**
   * What this message IS (F077). REQUIRED when a consent register is wired —
   * there is no safe default, because guessing transactional lets a marketing
   * blast bypass the gate and guessing marketing blocks one-time codes.
   */
  category?: SmsCategory;
  /**
   * Replaces the derived duplicate key for this send (F076.9).
   *
   * Works in BOTH directions: give two identical messages different keys and
   * both go out; give two different call-sites the same key and only the first
   * does. Use it when a legitimate repeat falls inside the lock window.
   */
  idempotencyKey?: string;
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
  /** True when the client deliberately did NOT send (dark, disabled, not allowlisted, duplicate). */
  skipped?: boolean;
  /**
   * WHICH kind of deliberate non-send. Present whenever `skipped` is.
   *
   * The four are not interchangeable: a skip in staging is expected, and a
   * `duplicate` suppressed in PRODUCTION is a signal that something upstream is
   * double-firing and somebody should look.
   */
  skippedReason?: SmsSkipReason;
  /** What it cost, or would have cost. Present even when skipped. */
  estimate?: SmsEstimate;
}

/** The one shape every adapter speaks, single or batched. */
export interface SmsSendInput {
  to: string;
  text: string;
  from: string;
}

/**
 * What an adapter must implement: ONE method. `sendMany` and `batchLimit` are
 * optional, and their absence is not a gap to be papered over — it is the
 * honest statement that this gateway has no proven multi-recipient endpoint,
 * which makes createSms() fan out instead. See `SmsClient.batch`.
 */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsSendInput): Promise<{ id?: string }>;
  /**
   * One HTTP call, many recipients. Returns ONE outcome per input message, in
   * input order — the core checks the length and treats any shortfall as
   * `unknown` rather than dropping those recipients.
   *
   * Throw only for a whole-request failure (a timeout, a non-2xx). A per-message
   * refusal belongs in that message's own outcome, so one bad number cannot take
   * the other 999 with it.
   */
  sendMany?(messages: SmsSendInput[]): Promise<BatchOutcome[]>;
  /**
   * Recipients the gateway accepts in ONE sendMany call. Measured from each
   * gateway's live schema, never guessed: GatewayAPI 1000, inMobile 250. They
   * differ by a factor of four, which is exactly why this is a provider property
   * and not a constant in the core.
   */
  readonly batchLimit?: number;
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
  /**
   * Retry a failed send (F076.11). OFF by default, and deliberately so.
   *
   * Unlike the duplicate lock — which PREVENTS money being spent — retry SPENDS
   * time, inside whatever request handler called you. A caller who did not ask
   * for it should not silently wait. Pass `true` for the defaults, or a config.
   *
   * An `unknown` outcome is NEVER retried, whatever you configure.
   */
  retry?: RetryConfig | true;
  /**
   * The consent register (F077). Omit it and nothing is gated.
   *
   * Wire it and `category` becomes REQUIRED on every send, and a MARKETING send
   * needs a recorded consent. A TRANSACTIONAL send is never blocked by either —
   * that is the whole point, not a special case.
   */
  consent?: ConsentRegistry;
  /**
   * The send-side duplicate lock (F076.9). ON BY DEFAULT with a 60-second window
   * and in-process memory — a fix behind a flag reaches only the people who read
   * changelogs, i.e. the people who did not need it.
   *
   * Pass a `store` to make it survive a restart or a second instance; pass
   * `false` to turn it off. Read `client.duplicateGuard` to see which you got.
   */
  duplicates?: DuplicateGuardConfig | false;
}

export interface SmsClient {
  /** The resolved delivery decision — assert this at boot. */
  readonly mode: DeliveryMode;
  /** What the duplicate lock actually guarantees. Assert this at boot too. */
  readonly duplicateGuard: DuplicateGuardMode;
  /**
   * What retry will actually do, or null when it is off.
   *
   * `worstCaseMs` is the question worth asking at boot: read it together with
   * your provider's `timeoutMs`, because three attempts against a 15-second
   * timeout is 45 seconds of requests PLUS this, and that total sits inside
   * someone's request handler.
   */
  readonly retryPolicy: RetryPolicy | null;
  /**
   * 'enforced' when a consent register is wired, 'off' otherwise.
   *
   * It says what is WIRED. It is not a statement that anything is lawful — see
   * the note at the top of consent.ts.
   */
  readonly consentMode: ConsentMode;
  readonly provider: string | null;
  /**
   * How a batch will actually go out — read it at boot.
   *
   * `mode: 'fan-out'` means 5,000 recipients cost 5,000 HTTP calls;
   * `'gateway-batch'` with `size: 1000` means five. That is a large enough
   * difference to be worth reading rather than assuming, and it changes when you
   * change provider, not when you change your code.
   */
  readonly batch: BatchPlan;
  estimate(text: string): SmsEstimate;
  /** What a whole batch costs, before you send it. */
  estimateMany(messages: ReadonlyArray<string | { text: string }>): SmsBatchEstimate;
  send(message: SmsMessage): Promise<SmsResult>;
  /**
   * Send to many recipients. ONE RESULT PER RECIPIENT, in the order given.
   *
   * Every per-recipient gate still runs per recipient — consent, the duplicate
   * lock, the price, the allowlist — and one failure never aborts the rest.
   */
  sendMany(messages: SmsMessage[], options?: SendManyOptions): Promise<SmsResult[]>;
}

/**
 * A recipient that has passed every gate and is ready for a gateway, or the
 * terminal result of one that did not.
 *
 * It exists so that send() and sendMany() CANNOT diverge: they run the same
 * prepare(), so a gate added to one is a gate added to both. A consent check
 * that ran on send() and not on sendMany() would be a marketing blast bypassing
 * consent for five thousand people at once, and it would look like a working
 * batch the whole way.
 */
type Prepared =
  | { go: false; result: SmsResult }
  | { go: true; to: string; sender: string; text: string; cost: SmsEstimate; lockKey: string | null };

declare const console: { warn(...args: unknown[]): void };

export function createSms(config: SmsConfig): SmsClient {
  const {
    provider = null,
    from,
    live = false,
    disabled = false,
    allowlist = [],
    defaultCountry = '45',
    duplicates,
    consent,
    retry,
  } = config;

  const retryPolicy = resolveRetry(retry);

  const guard = createDuplicateGuard(duplicates);

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

  const batch: BatchPlan = {
    mode: provider?.sendMany ? 'gateway-batch' : 'fan-out',
    size: provider?.sendMany ? (provider.batchLimit ?? 1) : 1,
    concurrency: DEFAULT_CONCURRENCY,
  };

  /**
   * Every per-recipient gate, in the order send() has always run them, in ONE
   * place so sendMany() cannot skip one.
   *
   * It also CLAIMS THE DUPLICATE LOCK, which is why sendMany() walks its input
   * sequentially: two copies of the same message inside one batch must not both
   * claim it, and a bulk import is exactly where that pair comes from.
   */
  const prepare = async (message: SmsMessage): Promise<Prepared> => {
    let to: string;
    try {
      to = normalisePhone(message.to, defaultCountry);
    } catch (err) {
      // Local refusal — nothing left this process, nothing was billed.
      return { go: false, result: { ok: false, outcome: 'refused', error: err instanceof Error ? err.message : String(err) } };
    }

    const cost = estimate(message.text);
    const stop = (result: SmsResult): Prepared => ({ go: false, result });

    // THE CONSENT GATE, and it runs BEFORE the dark-mode check on purpose: a
    // missing category is a programming error you want to meet in development,
    // and development IS dark mode. Meeting it in production instead is how a
    // marketing blast goes out ungated.
    if (consent && consent.mode !== 'off') {
      if (!message.category) {
        return stop({
          ok: false,
          outcome: 'refused',
          error:
            'sms: a consent register is wired, so every send must declare `category`: ' +
            "'transactional' (a one-time code, a receipt, an appointment change) or 'marketing'. " +
            'There is no default, because guessing transactional would let a marketing send bypass ' +
            'the consent gate and guessing marketing would block one-time codes. Nothing was sent.',
          estimate: cost,
        });
      }

      // A TRANSACTIONAL MESSAGE IS NEVER BLOCKED. Not by a missing consent, not
      // by an opt-out. An opt-out is from marketing; a one-time code is not
      // marketing, and blocking it locks someone out of their own account.
      if (message.category === 'marketing') {
        // THE WAY OUT COMES FIRST, because a template with no opt-out line is
        // wrong for EVERY recipient. Reporting the consent problem first would
        // send a developer hunting for a consenting test number to discover a
        // bug that is in their template.
        if (consent.optOutText && !message.text.includes(consent.optOutText)) {
          return stop({
            ok: false,
            outcome: 'refused',
            error:
              `sms: a marketing message must carry a way out, and this one does not contain ` +
              `${JSON.stringify(consent.optOutText)}. It is NOT added for you: SMS is billed per ` +
              `segment, so appending characters can turn a one-segment message into two and you ` +
              `would meet that on the invoice rather than here. Put it in the text yourself and ` +
              `check estimate() for what it costs. Nothing was sent.`,
            estimate: cost,
          });
        }

        const state = consent.mode === 'enforced' ? await consent.check(to) : 'consented';
        if (state !== 'consented') {
          return stop({
            ok: true,
            outcome: 'skipped',
            skipped: true,
            // Two reasons, not one: 'no-consent' usually means an import
            // failed; 'opted-out' is a person's decision.
            skippedReason: state === 'withdrawn' ? 'opted-out' : 'no-consent',
            estimate: cost,
          });
        }
      }
    }

    if (mode !== 'live' && !allowed.has(to)) {
      // Derived from `mode`, not from which branch we happen to be in: a
      // client with no provider is 'no-key', and reporting that as
      // "not allowlisted" sends the reader to check the wrong setting.
      const skippedReason: SmsSkipReason =
        mode === 'disabled' ? 'disabled' : mode === 'no-key' ? 'no-provider' : 'not-allowlisted';
      return stop({ ok: true, outcome: 'skipped', skipped: true, skippedReason, estimate: cost });
    }
    if (!provider) {
      return stop({ ok: true, outcome: 'skipped', skipped: true, skippedReason: 'no-provider', estimate: cost });
    }

    const sender = message.from ?? from;

    // The lock goes AFTER the skip checks — there is nothing to lock about a
    // send that was never going to happen — and BEFORE the gateway call, which
    // is where the money is spent.
    let lockKey: string | null = null;
    if (guard.mode !== 'off') {
      try {
        const key = await guard.fingerprint({
          from: sender,
          to,
          text: message.text,
          ...(message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : {}),
        });
        const claimed = await guard.claim(key);
        if (!claimed.ok) {
          return stop({
            ok: true,
            outcome: 'skipped',
            skipped: true,
            skippedReason: 'duplicate',
            // The id of the message that DID go, so the caller keeps its handle
            // for delivery status rather than losing track of it.
            ...(claimed.id ? { id: claimed.id } : {}),
            estimate: cost,
          });
        }
        lockKey = key;
      } catch (err) {
        // THE LOCK IS A SAFETY NET, NOT THE PRODUCT. If the store is
        // unreachable we send anyway and say so loudly, degrading to exactly
        // the behaviour this package had before the lock existed. A guard that
        // takes the whole SMS capability down when Redis hiccups is worse than
        // the duplicate it was protecting against — nobody logs in while the
        // one-time codes are blocked.
        console.warn(
          `[@broberg/sms] the duplicate lock is UNAVAILABLE (${err instanceof Error ? err.message : String(err)}) — ` +
            `sending WITHOUT duplicate protection. A repeat of this message will go out again.`,
        );
      }
    }

    return { go: true, to, sender, text: message.text, cost, lockKey };
  };

  type Go = Extract<Prepared, { go: true }>;

  /**
   * Turn a thrown error into this recipient's result, and settle its lock.
   *
   * ONE rule for both paths, so a batch cannot classify differently from a
   * single send: a REFUSAL voids the lock, because retrying a refused send is
   * exactly what a caller should do. An UNKNOWN HOLDS it — F076.6's rule
   * enforced rather than merely documented: the message may already have gone.
   */
  const settleFailure = async (p: Go, err: unknown): Promise<SmsResult> => {
    const unknown = isUnknownSendError(err);
    if (p.lockKey) await guard.settle(p.lockKey, unknown ? 'sent' : 'void');
    return {
      ok: false,
      outcome: unknown ? 'unknown' : 'refused',
      error: err instanceof Error ? err.message : String(err),
      estimate: p.cost,
    };
  };

  const succeed = async (p: Go, id: string | undefined): Promise<SmsResult> => {
    if (p.lockKey) await guard.settle(p.lockKey, 'sent', id);
    return { ok: true, outcome: 'sent', ...(id ? { id } : {}), estimate: p.cost };
  };

  const dispatchOne = async (p: Go): Promise<SmsResult> => {
    try {
      // The lock is claimed ONCE and settled ONCE, around all attempts — so a
      // retry inside here never trips the duplicate guard, and the guard still
      // records the final outcome.
      const res = await attemptSend(() => provider!.send({ to: p.to, text: p.text, from: p.sender }), retryPolicy);
      return succeed(p, res.id);
    } catch (err) {
      // The whole point of F076.6: an adapter that never heard an answer says so
      // with a BRANDED error, and it lands here as its own outcome rather than
      // as another `ok:false` a retry wrapper cannot tell apart.
      return settleFailure(p, err);
    }
  };

  return {
    mode,
    duplicateGuard: guard.mode,
    consentMode: consent?.mode ?? 'off',
    retryPolicy,
    batch,
    provider: provider?.name ?? null,
    estimate,
    estimateMany,

    async send(message: SmsMessage): Promise<SmsResult> {
      const p = await prepare(message);
      return p.go ? dispatchOne(p) : p.result;
    },

    async sendMany(messages: SmsMessage[], options: SendManyOptions = {}): Promise<SmsResult[]> {
      // ONE SLOT PER RECIPIENT, filled by index. Never an array built by pushing
      // as answers arrive: a batch that returns fewer results than it was given
      // silently drops people, and the caller cannot tell which.
      const results = new Array<SmsResult>(messages.length);
      const pending: Array<Go & { index: number }> = [];

      // SEQUENTIAL ON PURPOSE — prepare() claims the duplicate lock, and running
      // the gates concurrently would let two copies of the same message inside
      // one batch both claim it. A bulk import is exactly where that pair comes
      // from.
      //
      // AND THE HAZARD IS INVISIBLE IN THE EASY CASE, which is what makes it
      // worth stating: the in-memory store claims atomically, so a parallel gate
      // pass looks perfectly correct against it. On a SHARED store with only
      // get/set — the ordinary Redis or SQL wrapper, guard mode 'shared' — both
      // claims read "not held", both write "in flight", and both are billed. So
      // the sequential pass is not a simplification, it is the thing that makes
      // the lock hold for all three guard modes rather than one.
      //
      // The cost is one store round-trip per recipient before anything is sent;
      // with a remote store that is real, and it is still cheaper than the
      // duplicate it prevents.
      for (let i = 0; i < messages.length; i += 1) {
        const p = await prepare(messages[i]);
        if (p.go) pending.push({ ...p, index: i });
        else results[i] = p.result;
      }

      const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));

      // NO PROVEN BATCH ENDPOINT — fan out. One call per recipient, `concurrency`
      // in flight. Slower and more expensive in requests, and honest about it,
      // which is better than pretending a loop is a batch.
      if (!provider?.sendMany) {
        const done = await runPool(pending, concurrency, (p) => dispatchOne(p));
        pending.forEach((p, k) => {
          results[p.index] = done[k];
        });
        return results;
      }

      // Bound to the gateway's own measured limit. A 1,001-recipient send is
      // SPLIT, never rejected — the caller asked to reach 1,001 people, and the
      // transport's limit is this package's problem, not theirs.
      const batchSend = provider.sendMany.bind(provider);
      const size = Math.max(1, Math.floor(options.chunkSize ?? provider.batchLimit ?? pending.length ?? 1));
      const groups = chunk(pending, size);

      await runPool(groups, concurrency, async (group) => {
        let outcomes: BatchOutcome[];
        try {
          outcomes = await attemptSend(
            () => batchSend(group.map((p) => ({ to: p.to, text: p.text, from: p.sender }))),
            retryPolicy,
          );
        } catch (err) {
          // THE WHOLE CALL FAILED — a timeout, an unreachable host, a 5xx that
          // outlived retry. Nobody in this chunk got a per-recipient answer, so
          // each is settled by the same brand the single path uses. A timeout
          // here is `unknown` for every recipient in it: the gateway may have
          // taken all of them, and this is precisely where a naive retry would
          // re-send a thousand delivered messages.
          for (const p of group) results[p.index] = await settleFailure(p, err);
          return null;
        }

        for (let k = 0; k < group.length; k += 1) {
          const p = group[k];
          const outcome = outcomes[k] as BatchOutcome | undefined;
          if (!outcome) {
            // FEWER ANSWERS THAN RECIPIENTS. Never silently dropped: the gateway
            // may well have sent these, so they are `unknown`, not `refused`.
            results[p.index] = await settleFailure(
              p,
              new SmsUnknownError(
                `${provider.name}: the batch returned ${outcomes.length} result(s) for ${group.length} ` +
                  `recipient(s), so there is no answer for this one. It may still have been sent — ` +
                  `do NOT retry blindly.`,
              ),
            );
            continue;
          }
          results[p.index] = outcome.ok ? await succeed(p, outcome.id) : await settleFailure(p, outcome.error);
        }
        return null;
      });

      return results;
    },
  };
}

export { gatewayapi, type GatewayApiConfig } from './providers/gatewayapi';
export { smsdk, type SmsDkConfig } from './providers/smsdk';
export { inmobile, type InMobileConfig } from './providers/inmobile';
export * from './delivery';
export * from './idempotency';
export * from './lock';
export * from './consent';
export * from './webhook';
export * from './retry';
export * from './batch';

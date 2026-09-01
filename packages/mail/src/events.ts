/**
 * The provider's event vocabulary, and the ONE mapping from it onto the only
 * question anyone actually asks.
 *
 * Shared by the webhook parser (which sees events pushed to you) and by
 * `getStatus` (which asks for the latest one), so the two can never disagree
 * about what an event means. Before F005.11 the list lived only in webhook.ts
 * and had been written before Resend grew four more types — of which
 * `email.failed` and `email.suppressed` are precisely the two that mean the
 * mail did not arrive.
 */

/** Every email event Resend documents (11, verified against their event-types
 *  page on 2026-08-31). Ordered as they list them. */
export type MailEventType =
  | 'sent'
  | 'delivered'
  | 'delivery_delayed'
  | 'bounced'
  | 'complained'
  | 'opened'
  | 'clicked'
  | 'failed'
  | 'received'
  | 'scheduled'
  | 'suppressed';

export const MAIL_EVENT_TYPES: readonly MailEventType[] = [
  'sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'opened',
  'clicked',
  'failed',
  'received',
  'scheduled',
  'suppressed',
];

/**
 * What a consumer actually decides on.
 *
 * `unknown` is a FIRST-CLASS outcome, not an error code — a send-only key
 * answers 401, a wrong id answers 404, the network answers nothing, and none of
 * those is "the mail failed". Render a permission problem as a bounce and the
 * consumer writes to the customer to say their address is wrong.
 */
export type MailVerdict = 'delivered' | 'failed' | 'pending' | 'unknown';

// WHY THE WARNING BELOW IS ON THE EXPORTED FUNCTION AND NOT HERE (F081.3's
// sibling defect, caught by test/shipped-claims.test.ts): a doc comment on a
// non-exported const is stripped from dist/index.d.ts. 0.10.0's first cut put
// this table between that warning and `verdictForEvent`, and the warning
// stopped shipping — the one sentence that stops a consumer reading
// `suppressed` as "the recipient never got it" vanished from the published
// types while every test still passed. Anything a CONSUMER must read belongs
// on an exported symbol.
// The table, and it is a table rather than a `switch` ON PURPOSE (F005.13).
//
// `Record<MailEventType, MailVerdict>` makes a MISSING key a compile error, so
// adding an event to the vocabulary without deciding what it means still fails
// the build. A `switch` with a `default:` would have silenced exactly that —
// trading a loud `undefined` for a quiet wrong answer, which for a
// `bounced`-shaped new event means a failed delivery reading as undecided.
const VERDICT: Record<MailEventType, MailVerdict> = {
  delivered: 'delivered',
  opened: 'delivered',
  clicked: 'delivered',
  complained: 'delivered',
  bounced: 'failed',
  failed: 'failed',
  suppressed: 'failed',
  sent: 'pending',
  scheduled: 'pending',
  delivery_delayed: 'pending',
  received: 'unknown',
};

/**
 * Map one provider event onto a verdict.
 *
 * The two rows nobody gets right by intuition, and the whole reason this lives
 * in the package rather than in seventeen repos:
 *
 *   complained → delivered  it ARRIVED; the recipient then pressed "spam".
 *                           Filed under failure, a repo tells a customer their
 *                           address is broken when it is fine.
 *   suppressed → failed     at least ONE recipient was skipped (an address on
 *                           the suppression list). Filed under pending, a repo
 *                           waits for a delivery that cannot come.
 *
 * ⚠️ `last_event` IS A MESSAGE STATUS, NOT A RECIPIENT STATUS, and this comment
 * said the opposite through 0.8.1 — that the send had not been tried at all.
 * Measured by
 * fd-sundhed against production on 2026-08-31, with a control and an independent
 * witness: a mail to [cb@webhouse.dk, <a suppressed address>] reported
 * `suppressed` AND cb@webhouse.dk received it (id 37a5ac15-…; cardmem's mail
 * watcher saw it land at 19:47:54). A single-recipient control reported
 * `delivered` (id 43a7af23-…).
 *
 * So on a multi-recipient send, `suppressed` means SOME address was skipped —
 * the others are delivered. The verdict stays `failed` on purpose: it is correct
 * for one recipient, and `failed` is the STRICT branch. Loosening the default
 * would widen the gate at every consumer that has not yet handled a new case
 * (F070). To tell "one of three" from "all three" you need the suppression list
 * itself — see F005.12; there is no getSuppressions() yet.
 *
 * Resend's own documentation does not describe this behaviour at all, so the
 * measurement above is the ONLY evidence. Do not upgrade it to a spec claim.
 *
 * And one that is not a delivery question at all: `received` is INBOUND — "Resend
 * successfully receives an email", i.e. mail arriving at your inbound address.
 * It carries no information about an outbound mail, so it answers `unknown`
 * rather than being forced onto the outbound axis. (Checked against the spec
 * rather than inferred from the word: read as English, "received" looks like the
 * strongest possible delivery confirmation, which is the opposite of true.)
 */
/**
 * ⚠️ TAKES A PLAIN STRING, and answers `'unknown'` for anything it does not
 * recognise. Through 0.9.1 the parameter was `MailEventType` and the body was an
 * exhaustive `switch` with no fall-through, so an event Resend adds next month
 * returned **`undefined` while the signature promised a `MailVerdict`** — a
 * consumer switching on the result got a silent nothing, and a mail whose
 * delivery is UNKNOWN read as a mail with no verdict at all. Measured on the
 * published package.
 *
 * That is not hypothetical here: the header above records the vocabulary going
 * stale ALREADY ONCE, when Resend grew four types and two of them meant the mail
 * did not arrive. This is what the next time looks like.
 *
 * An exhaustive switch is a COMPILE-TIME proof about the union. The input is a
 * string off the wire, and a JavaScript consumer has no types at all — so the
 * package needs both layers, not the better-looking one.
 */
export function verdictForEvent(event: MailEventType | (string & {})): MailVerdict {
  // OWN-property, not a bare lookup: an object literal inherits Object.prototype,
  // so `VERDICT['toString']` is a FUNCTION. Without this, verdictForEvent
  // ('toString') would return a function where a string is promised — the same
  // class of defect one layer down.
  return Object.prototype.hasOwnProperty.call(VERDICT, event as string)
    ? VERDICT[event as MailEventType]
    : 'unknown';
}

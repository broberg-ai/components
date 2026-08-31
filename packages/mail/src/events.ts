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

/**
 * Map one provider event onto a verdict.
 *
 * The two rows nobody gets right by intuition, and the whole reason this lives
 * in the package rather than in seventeen repos:
 *
 *   complained → delivered  it ARRIVED; the recipient then pressed "spam".
 *                           Filed under failure, a repo tells a customer their
 *                           address is broken when it is fine.
 *   suppressed → failed     it was never attempted (the address is on a
 *                           suppression list). Filed under pending, a repo
 *                           waits for a delivery that cannot come.
 *
 * And one that is not a delivery question at all: `received` is INBOUND — "Resend
 * successfully receives an email", i.e. mail arriving at your inbound address.
 * It carries no information about an outbound mail, so it answers `unknown`
 * rather than being forced onto the outbound axis. (Checked against the spec
 * rather than inferred from the word: read as English, "received" looks like the
 * strongest possible delivery confirmation, which is the opposite of true.)
 */
export function verdictForEvent(event: MailEventType): MailVerdict {
  switch (event) {
    case 'delivered':
    case 'opened':
    case 'clicked':
    case 'complained':
      return 'delivered';
    case 'bounced':
    case 'failed':
    case 'suppressed':
      return 'failed';
    case 'sent':
    case 'scheduled':
    case 'delivery_delayed':
      return 'pending';
    case 'received':
      return 'unknown';
  }
}

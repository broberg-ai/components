// sms.dk (Compaya) — the v1 REST API.
//
// F076.4. Built against their live Postman collection (docs.sms.dk, fetched
// 2026-08-23) and probed against the real account, not from recall.
//
// THE THING THAT MAKES THIS ADAPTER DIFFERENT FROM GATEWAYAPI'S, and it is the
// one that bites: HTTP SUCCESS DOES NOT MEAN THE MESSAGE WAS ACCEPTED. They use
// four shapes and `res.ok` is true for two of them:
//
//   200 status:"success"  every recipient accepted
//   207 status:"mixed"    SOME accepted, some rejected — res.ok is TRUE here
//   409 status:"error"    e.g. the sender name is not approved on the account
//   409 status:"error" 1059  every recipient rejected; the reason is buried in
//                            errorResult.report.rejected, not in `message`
//
// A 207 with our one recipient in `rejected` is a message that WAS NOT SENT,
// arriving as a 2xx. So the success test here is not the status code and not
// even `status`: it is whether our recipient is in report.accepted.
//
// The reason is always per-recipient. `message` at the top says only
// "See specific error in returned rejected array." — a top-level error string
// that tells you to go and read somewhere else.
//
// Also measured, and worth writing down because it cost a probe: their own
// documented path for the credit endpoint (/user/getcreditvalue) 404s. It is
// /v1/user/getcreditvalue. A documented example is not the live API.

import { checkSenderName, estimate, type SmsProvider } from '../index';

export interface SmsDkConfig {
  /** Bearer token from the sms.dk web interface. */
  apiKey: string;
  /** Escape hatch for a test double or a proxy. */
  baseUrl?: string;
  /**
   * Delivery reports are GET'd to this URL if set (F076.5). Their term is dlrUrl.
   * Without it, "accepted" is the last thing you ever learn about a message.
   */
  dlrUrl?: string;
  /** Your own reference, echoed back on delivery reports. Max 100 characters. */
  userReference?: string;
  /**
   * Abort after this many ms. A timeout does NOT mean the message was not sent —
   * see the error text.
   */
  timeoutMs?: number;
}

const DEFAULT_BASE = 'https://api.sms.dk';

/** Their per-recipient rejection entry. The reason lives here, never at the top. */
interface Rejected {
  receiver?: unknown;
  messageCode?: unknown;
  message?: unknown;
}

interface SendBody {
  status?: unknown;
  messageCode?: unknown;
  message?: unknown;
  result?: {
    totalCreditSum?: unknown;
    messageSize?: unknown;
    batchId?: unknown;
    report?: { accepted?: unknown[]; rejected?: Rejected[] };
  };
  errorResult?: { report?: { accepted?: unknown[]; rejected?: Rejected[] } };
}

/** Pull the human-readable reason out of wherever they put it this time. */
function rejectionReason(body: SendBody): string | null {
  const rejected = body.result?.report?.rejected ?? body.errorResult?.report?.rejected ?? [];
  if (!rejected.length) return null;
  return rejected
    .map((r) => {
      const who = r.receiver != null ? `${r.receiver}: ` : '';
      const code = r.messageCode != null ? ` (code ${r.messageCode})` : '';
      return `${who}${typeof r.message === 'string' ? r.message : 'rejected'}${code}`;
    })
    .join('; ');
}

export function smsdk(config: SmsDkConfig): SmsProvider {
  const { apiKey, baseUrl, dlrUrl, userReference, timeoutMs = 15_000 } = config;

  if (!apiKey) {
    throw new Error(
      'smsdk: apiKey is empty. Ship-dark by passing NO provider to createSms() ' +
        '(mode becomes "no-key"); a provider holding an empty key would fail on every send instead.',
    );
  }

  const root = (baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  const url = `${root}/v1/sms/send`;

  return {
    name: 'smsdk',

    async send({ to, text, from }) {
      // Shared with the GatewayAPI adapter — both gateways publish the same
      // 11/15 limit, so it is the SMS standard rather than one vendor's rule.
      const senderProblem = checkSenderName(from, 'smsdk');
      if (senderProblem) throw new Error(senderProblem);

      // They strip plus signs and leading zeros themselves, but we send clean
      // digits so the number they bill is unambiguously the one we meant.
      const receiver = Number(to.replace(/^\+/, ''));
      if (!Number.isSafeInteger(receiver)) {
        throw new Error(`smsdk: ${JSON.stringify(to)} is not a usable recipient number.`);
      }

      // We already know the encoding — we computed it to price the message — so
      // declare it rather than letting them guess. Their 'unicode' is our 'ucs-2'.
      const format = estimate(text).encoding === 'ucs-2' ? 'unicode' : 'gsm';

      const body: Record<string, unknown> = {
        receiver,
        senderName: from,
        message: text,
        format,
        encoding: 'utf8',
      };
      if (dlrUrl) body.dlrUrl = dlrUrl;
      if (userReference) body.userReference = userReference;

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        if (timedOut) {
          throw new Error(
            `smsdk: no response within ${timeoutMs}ms. THE MESSAGE MAY OR MAY NOT HAVE BEEN SENT ` +
              `— and may already have been billed. Do NOT retry blindly; check the log first.`,
          );
        }
        throw new Error(`smsdk: could not reach ${url} — ${err instanceof Error ? err.message : String(err)}`);
      }

      const raw = await res.text();

      let parsed: SendBody;
      try {
        parsed = JSON.parse(raw) as SendBody;
      } catch {
        // An HTML body here means the path is wrong — their 404s render a page
        // rather than JSON, which is exactly how /user/getcreditvalue hid from us.
        throw new Error(
          `smsdk: ${res.status} but the body was not JSON — usually a wrong path, since their 404 serves an HTML page: ${raw.slice(0, 160)}`,
        );
      }

      const reason = rejectionReason(parsed);

      // The success test is NOT the status code, and not `status` either. It is
      // whether our recipient made it into `accepted`. A 207 "mixed" is res.ok
      // and can still mean this exact message went nowhere.
      const accepted = parsed.result?.report?.accepted ?? [];
      if (accepted.length > 0 && !reason) {
        const id = typeof parsed.result?.batchId === 'string' ? parsed.result.batchId : undefined;
        return id ? { id } : {};
      }

      if (reason) {
        throw new Error(
          `smsdk ${res.status}: the gateway REJECTED this recipient — ${reason}` +
            (accepted.length ? ` (${accepted.length} other recipient(s) were accepted)` : ''),
        );
      }

      const top = typeof parsed.message === 'string' ? parsed.message : raw.slice(0, 300);
      const code = parsed.messageCode != null ? ` [code ${parsed.messageCode}]` : '';
      throw new Error(
        `smsdk ${res.status}${code}: ${top}` +
          (res.status === 409 && /senderName/i.test(top)
            ? ` — sender names must be approved in the sms.dk web interface before they can be used.`
            : ''),
      );
    },
  };
}

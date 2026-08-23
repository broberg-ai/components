// F076.8 — the assembled webhook route.
//
// F076.5 shipped the PARTS: verifyGatewayApiSignature, the parsers, the
// fetchers. A consumer still had to assemble them, and the assembly has three
// ways to go wrong of which two are silent.
//
// 1. THE RAW BODY. Verification must run on the bytes as received. A consumer
//    who does `await req.json()` and re-serialises for the signature check gets
//    a mismatch from key order or whitespace alone — and the natural "fix" is to
//    stop verifying. This handler owns the read, so it cannot happen.
//
// 2. THE 5-SECOND, 2xx CONTRACT. GatewayAPI retries for 24 HOURS unless the
//    handler answers 2xx within five seconds. A consumer who awaits their own
//    slow work first turns one event into a retry storm. So: verify, parse,
//    ACKNOWLEDGE, then do the work.
//
// 3. A THROW IS A NON-2xx, and earns the same storm. Nothing here throws.
//
// WHAT IT IS NOT: a framework. One dependency-free core over a standard
// Request, plus a four-line Hono adapter — the same split @broberg/pwa and
// @broberg/forms-turnstile already use. hono stays an optional peer.

import {
  parseGatewayApiWebhook,
  parseInMobileReports,
  parseSmsDkDlr,
  verifyGatewayApiSignature,
  type DeliveryReport,
} from './delivery';

declare const console: { warn(...args: unknown[]): void };

export type WebhookProvider = 'gatewayapi' | 'smsdk' | 'inmobile';

export interface SmsWebhookOptions {
  /**
   * Your delivery handler. It runs AFTER the 2xx has been returned, so it may be
   * as slow as it likes — that is the whole point of the route.
   *
   * Dedupe here (createDeliveryInbox): GatewayAPI's retries mean the same event
   * WILL arrive twice.
   */
  onReports(reports: DeliveryReport[], provider: WebhookProvider): void | Promise<void>;
  /**
   * GatewayAPI's HMAC secret.
   *
   * If set, a GatewayAPI callback with a bad or missing signature is REFUSED and
   * the body is never parsed. If NOT set, GatewayAPI callbacks are accepted
   * unverified — which is a decision, so it is logged once per call rather than
   * left silent.
   */
  secret?: string;
  /**
   * A shared token required on EVERY callback, checked against `?token=` or the
   * `X-Sms-Token` header.
   *
   * THIS IS THE ONLY DEFENCE THE OTHER TWO PROVIDERS HAVE. GatewayAPI signs its
   * callbacks; sms.dk and inMobile do not sign anything, so without this their
   * endpoint is a public URL that writes to your database on request. Generate
   * one with `openssl rand -hex 32` and put it in the URL you give them.
   */
  sharedToken?: string;
  /**
   * Called when `onReports` throws. The response was already sent, so the error
   * has nowhere else to go — without this hook it would be swallowed.
   */
  onError?(err: unknown, provider: WebhookProvider): void;
  /**
   * Hand the post-acknowledgement work to the runtime, so a serverless platform
   * does not freeze the process the moment the response is returned.
   *
   * Cloudflare Workers and Vercel expose `ctx.waitUntil` — pass it. On a
   * long-lived Node/Bun server you do not need it. WITHOUT IT ON SERVERLESS the
   * work can be cut short after the 2xx, and for GatewayAPI that loses the status
   * permanently, because they offer no polling to fall back on.
   */
  waitUntil?(promise: Promise<unknown>): void;
}

/** Which provider sent this? Decided on shape, because none of them announce it. */
function sniff(method: string, body: string): WebhookProvider {
  // sms.dk is the only one that calls with a GET and no body.
  if (method === 'GET') return 'smsdk';
  if (body.includes('"event_type"')) return 'gatewayapi';
  return 'inmobile';
}

const ok = (): Response => new Response(null, { status: 204 });
const deny = (why: string): Response => new Response(why, { status: 401 });

/**
 * A drop-in delivery-webhook handler over a standard `Request`.
 *
 * ```ts
 * const handler = createSmsWebhook({
 *   secret: process.env.GATEWAYAPI_WEBHOOK_SECRET,
 *   sharedToken: process.env.SMS_WEBHOOK_TOKEN,
 *   async onReports(reports) {
 *     for (const v of await inbox.accept(reports)) {
 *       if (v.fresh) await db.setStatus(v.report.id, v.state);
 *     }
 *   },
 * });
 * ```
 */
export function createSmsWebhook(options: SmsWebhookOptions): (request: Request) => Promise<Response> {
  const { onReports, secret, sharedToken, onError, waitUntil } = options;

  return async function handle(request: Request): Promise<Response> {
    let provider: WebhookProvider = 'gatewayapi';
    try {
      const url = new URL(request.url);

      // The shared token first: it is the cheapest check and the only one the
      // unsigned providers have.
      if (sharedToken) {
        const given = url.searchParams.get('token') ?? request.headers.get('x-sms-token') ?? '';
        if (given !== sharedToken) return deny('bad token');
      }

      // OWN THE READ. A consumer who parses first and re-serialises for the
      // signature gets a mismatch from key order alone.
      const raw = request.method === 'GET' ? '' : await request.text();
      provider = sniff(request.method, raw);

      if (provider === 'gatewayapi') {
        if (secret) {
          const valid = await verifyGatewayApiSignature(raw, request.headers.get('signature'), secret);
          // NOT PARSED on failure — the payload is untrusted until the signature
          // says otherwise, and a test asserts onReports was never called.
          if (!valid) return deny('bad signature');
        } else {
          console.warn(
            '[@broberg/sms] a GatewayAPI callback was accepted WITHOUT verifying its signature — ' +
              'no `secret` is configured. Anyone who finds this URL can write delivery statuses.',
          );
        }
      }

      const reports =
        provider === 'smsdk'
          ? ([parseSmsDkDlr(url.searchParams)].filter(Boolean) as DeliveryReport[])
          : provider === 'gatewayapi'
            ? parseGatewayApiWebhook(safeJson(raw))
            : parseInMobileReports(safeJson(raw));

      // ACKNOWLEDGE, THEN WORK. Awaiting the caller's handler here is what turns
      // one event into a 24-hour retry storm, so the promise is deliberately not
      // awaited — see `waitUntil` for the serverless half of this trade.
      const work = Promise.resolve()
        .then(() => onReports(reports, provider))
        .catch((err: unknown) => {
          // The response has already gone. Re-throwing would become an unhandled
          // rejection, and a non-2xx is not available to us any more anyway.
          if (onError) onError(err, provider);
          else
            console.warn(
              `[@broberg/sms] the delivery webhook handler threw after the 2xx was sent: ` +
                `${err instanceof Error ? err.message : String(err)}. Pass onError to see these.`,
            );
        });
      if (waitUntil) waitUntil(work);

      return ok();
    } catch (err) {
      // Anything unexpected BEFORE acknowledgement. Still a 2xx: a non-2xx buys
      // a 24-hour retry of an event we cannot parse any better on the tenth try.
      if (onError) onError(err, provider);
      else
        console.warn(
          `[@broberg/sms] the delivery webhook could not process a callback: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      return ok();
    }
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // The parsers all tolerate a non-array, non-object input and return [].
    return null;
  }
}

/**
 * The same handler for Hono. Four lines, and hono stays an optional peer — this
 * takes the context structurally rather than importing anything.
 *
 * ```ts
 * app.all("/sms/status", smsWebhookHono({ secret, onReports }));
 * ```
 */
export function smsWebhookHono(
  options: SmsWebhookOptions,
): (c: HonoLikeContext) => Promise<Response> {
  return (c) => {
    // WIRE THE RUNTIME'S waitUntil IF IT HAS ONE. On Cloudflare and Vercel, hono
    // exposes it as c.executionCtx.waitUntil, and it is the difference between
    // the post-acknowledgement work finishing and being frozen mid-flight. An
    // adapter that accepted the context and ignored this would LOOK wired.
    const runtime = c.executionCtx?.waitUntil?.bind(c.executionCtx);
    const handle = createSmsWebhook(
      options.waitUntil || !runtime ? options : { ...options, waitUntil: runtime },
    );
    // Hono hands the untouched Request through as c.req.raw, which is exactly
    // what the core needs — the bytes, not a parsed body.
    return handle(c.req.raw);
  };
}

/** Structural, so hono is never imported and never becomes a dependency. */
export interface HonoLikeContext {
  req: { raw: Request };
  executionCtx?: { waitUntil?(promise: Promise<unknown>): void };
}

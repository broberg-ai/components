// @broberg/mail/hono — the delivery webhook as a Hono handler.
//
//   app.post('/webhooks/mail', mailWebhook({ secret: env.RESEND_WEBHOOK_SECRET, onEvent }))
//
// No dependency on hono: the handler only needs `c.req.raw`, the standard
// Request every Hono version exposes. Verify and parse live in ./webhook.
import { mailWebhookFetchHandler, type WebhookHandlerConfig } from './webhook';

export type { MailEvent, WebhookHandlerConfig } from './webhook';

export function mailWebhook(config: WebhookHandlerConfig): (c: { req: { raw: Request } }) => Promise<Response> {
  const handle = mailWebhookFetchHandler(config);
  return (c) => handle(c.req.raw);
}

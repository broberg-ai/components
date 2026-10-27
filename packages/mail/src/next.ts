// @broberg/mail/next — the delivery webhook as a Next.js App Router route.
//
//   // app/api/webhooks/mail/route.ts
//   export const POST = mailWebhookRoute({ secret: process.env.RESEND_WEBHOOK_SECRET, onEvent });
//
// No dependency on next: a route handler is a plain (Request) => Response.
// Verify and parse live in ./webhook.
import { mailWebhookFetchHandler, type WebhookHandlerConfig } from './webhook';

export type { MailEvent, WebhookHandlerConfig } from './webhook';

export function mailWebhookRoute(config: WebhookHandlerConfig): (req: Request) => Promise<Response> {
  return mailWebhookFetchHandler(config);
}

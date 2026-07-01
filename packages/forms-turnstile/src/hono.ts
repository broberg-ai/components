/**
 * Hono middleware — runs the spam gauntlet (honeypot + rate-limit + Turnstile)
 * before the route handler, short-circuiting with a 400 on block. Models the
 * pattern proven in xrt81's leads.ts route.
 *
 * Reads the request body itself (JSON) so it can inspect the Turnstile token +
 * honeypot field, and stashes the parsed body on the Hono context under
 * `spamCheckedBody` so the downstream handler doesn't re-read the (already
 * consumed) request stream.
 */

import type { Context, MiddlewareHandler } from "hono";
import { applySpamGauntlet, hashIp, type SpamBlockReason } from "./server.js";

export interface HonoTurnstileOptions {
  /** TURNSTILE_SECRET_KEY for this site. */
  secret: string;
  /** Form identifier — scopes the rate-limit counter. */
  formName: string;
  /** Body field holding the Turnstile token. Default "token". */
  tokenField?: string;
  /** Run the honeypot check. Default true. */
  honeypot?: boolean;
  /** Max submissions/hour per IP before rate-limiting blocks. Omit to skip rate-limiting. */
  maxPerHour?: number;
  /** Header to read the client IP from. Default "CF-Connecting-IP". */
  ipHeader?: string;
  /** Override the default 400 JSON response on block. */
  onBlocked?: (c: Context, reason: SpamBlockReason) => Response;
}

/** Hono middleware enforcing the spam gauntlet on a public form POST route. */
export function honoTurnstileMiddleware(opts: HonoTurnstileOptions): MiddlewareHandler {
  const tokenField = opts.tokenField ?? "token";
  const ipHeader = opts.ipHeader ?? "CF-Connecting-IP";

  return async (c, next) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ip =
      c.req.header(ipHeader) ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      "";

    const result = await applySpamGauntlet({
      honeypot: opts.honeypot === false ? undefined : { body },
      rateLimit: opts.maxPerHour
        ? { ipHash: hashIp(ip), formName: opts.formName, maxPerHour: opts.maxPerHour }
        : undefined,
      turnstile: { token: String(body[tokenField] ?? ""), secret: opts.secret, remoteip: ip || undefined },
    });

    if (result.blocked) {
      if (opts.onBlocked) return opts.onBlocked(c, result.reason as SpamBlockReason);
      return c.json({ error: "Request blocked" }, 400);
    }

    c.set("spamCheckedBody", body);
    await next();
  };
}

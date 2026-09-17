import { describe, expect, it } from "vitest";
import { getInboundEmail, toInboundEmail } from "../src/index.js";
import { parseInboundMail } from "../src/webhook.js";

/**
 * INBOUND MAIL — filed by helpdesk, measured against the live API 2026-09-17.
 *
 * The payloads below are REAL, copied from a mail actually sent to
 * support@support.broberg.ai and read back out of the provider. They are not
 * reconstructions, and that matters: the bug this package is closing is that
 * helpdesk's own test used an INVENTED shape (a `headers` field, a `to` as a
 * string) and was green on a form the provider never sends.
 */

/** The webhook body, verbatim. Note what is NOT here: text, html, headers. */
const WEBHOOK_BODY = JSON.stringify({
  type: "email.received",
  created_at: "2026-09-17T00:46:47.000Z",
  data: {
    attachments: [],
    bcc: [],
    cc: [],
    created_at: "2026-09-17T00:46:49.278Z",
    email_id: "d6871dd1-7c51-4df6-b55e-2ed8ed8b9734",
    from: "cb@webhouse.dk",
    message_id: "<010201a0acd49476-da619658@eu-west-1.amazonses.com>",
    received_for: ["support@support.broberg.ai"],
    subject: "F007.9-transport",
    to: ["support@support.broberg.ai"],
  },
});

/** The lookup response, verbatim. THIS is where the letter lives. */
const LOOKUP_BODY = {
  object: "email",
  id: "d6871dd1-7c51-4df6-b55e-2ed8ed8b9734",
  to: ["support@support.broberg.ai"],
  from: "cb@webhouse.dk",
  created_at: "2026-09-17T00:46:49.278Z",
  subject: "F007.9-transport",
  message_id: "<010201a0acd49476-da619658@eu-west-1.amazonses.com>",
  bcc: [],
  cc: [],
  reply_to: [],
  html: null,
  text: "Proeve af den indgaaende vej.\n",
  headers: { "Return-Path": "bounce@send.webhouse.dk", "In-Reply-To": "<abc@x.dk>" },
};

const okFetch = (body: unknown, status = 200) =>
  (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;

describe("parseInboundMail — the envelope, and only the envelope", () => {
  it("reads the real webhook body", () => {
    const e = parseInboundMail(WEBHOOK_BODY)!;
    expect(e).not.toBeNull();
    expect(e.emailId).toBe("d6871dd1-7c51-4df6-b55e-2ed8ed8b9734");
    expect(e.to).toEqual(["support@support.broberg.ai"]);
    expect(e.receivedFor).toEqual(["support@support.broberg.ai"]);
    expect(e.subject).toBe("F007.9-transport");
  });

  it("translates snake_case at the boundary — message_id is the intake key", () => {
    // A field named ALMOST right reads as undefined once and is never noticed.
    // Without the intake key, every re-delivery of the same mail becomes a
    // second case with its own reply to the same person.
    const e = parseInboundMail(WEBHOOK_BODY)!;
    expect(e.messageId).toBe("<010201a0acd49476-da619658@eu-west-1.amazonses.com>");
  });

  it("`to` is ALWAYS a list, even when the provider sends a bare string", () => {
    // The production failure this package exists to prevent: a string-reader
    // answers "" for an array, and every mail is rejected with a correctly
    // worded reason. It fails GREEN.
    const b = JSON.parse(WEBHOOK_BODY);
    b.data.to = "one@example.com";
    const e = parseInboundMail(JSON.stringify(b))!;
    expect(e.to).toEqual(["one@example.com"]);
    expect(Array.isArray(e.to)).toBe(true);
  });

  it("a DELIVERY event is not inbound mail", () => {
    // Reshaping one into the other is how a bounce lands in a support queue as
    // a customer message.
    expect(parseInboundMail(JSON.stringify({ type: "email.delivered", data: {} }))).toBeNull();
    expect(parseInboundMail(JSON.stringify({ type: "email.sent", data: {} }))).toBeNull();
    expect(parseInboundMail("not json")).toBeNull();
  });

  it("CARRIES NO BODY — the absent fields are the point", () => {
    // If this ever starts passing with a body, the provider changed and the
    // whole reason getInboundEmail() exists needs re-checking.
    const e = parseInboundMail(WEBHOOK_BODY)! as unknown as Record<string, unknown>;
    expect(e.text).toBeUndefined();
    expect(e.html).toBeUndefined();
    expect(e.headers).toBeUndefined();
  });
});

describe("getInboundEmail — the letter, and four honest outcomes", () => {
  it("returns the body AND the threading headers", async () => {
    const r = await getInboundEmail("id-1", { apiKey: "re_x", fetch: okFetch(LOOKUP_BODY) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mail.text).toBe("Proeve af den indgaaende vej.\n");
    // Lower-cased, so a caller never guesses the provider's casing.
    expect(r.mail.headers["in-reply-to"]).toBe("<abc@x.dk>");
    expect(r.mail.messageId).toBe("<010201a0acd49476-da619658@eu-west-1.amazonses.com>");
    expect(r.mail.to).toEqual(["support@support.broberg.ai"]);
  });

  it("404 is `not_found` — the provider looked and has nothing", async () => {
    const r = await getInboundEmail("gone", { apiKey: "re_x", fetch: okFetch({}, 404) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_found");
  });

  it("401 is `could_not_ask`, NOT `not_found` — a send-only key is our fault", async () => {
    // THE SPLIT THAT MATTERS. Collapsed, a repo tells a person their message
    // was lost when the real problem is our own credential.
    const r = await getInboundEmail("id-1", { apiKey: "re_sendonly", fetch: okFetch({}, 401) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("could_not_ask");
    expect(r.detail).toContain("NOT a missing message");
  });

  it("no key, no fetch, no id, a dead network — all `could_not_ask`", async () => {
    const dead = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    for (const r of [
      await getInboundEmail("id", {}),
      await getInboundEmail("", { apiKey: "re_x", fetch: okFetch(LOOKUP_BODY) }),
      await getInboundEmail("id", { apiKey: "re_x", fetch: dead }),
      await getInboundEmail("id", { apiKey: "re_x", fetch: okFetch("not an object") }),
    ]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("could_not_ask");
    }
  });

  it("a null html is absent, not the string 'null'", async () => {
    // The provider sends html: null on a text-only mail. Carried through
    // naively it becomes a case body reading "null" to a human.
    const r = await getInboundEmail("id-1", { apiKey: "re_x", fetch: okFetch(LOOKUP_BODY) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mail.html).toBeUndefined();
  });

  it("shapes a response with NOTHING in it without throwing", async () => {
    // Ship dark: an empty object is a bad answer, not a crash.
    const m = toInboundEmail({});
    expect(m.to).toEqual([]);
    expect(m.headers).toEqual({});
    expect(m.text).toBeUndefined();
  });
});

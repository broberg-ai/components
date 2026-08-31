import { describe, expect, it } from "vitest";
import {
  createMailer,
  verdictForEvent,
  MAIL_EVENT_TYPES,
  type MailEventType,
  type MailVerdict,
} from "../src/index";
import { parseMailEvent } from "../src/webhook";

// The response body quoted from Resend's own retrieve-email example, read off
// the live spec on 2026-08-31 — not recalled, and not reshaped. If they change
// it, this fixture agrees only with itself, so the doc records the date.
const RESEND_BODY = {
  object: "email",
  id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
  message_id: "<111-222-333@email.example.com>",
  to: ["delivered@resend.dev"],
  from: "Acme <onboarding@resend.dev>",
  created_at: "2026-04-03 22:13:42.674981+00",
  subject: "Hello World",
  html: "Congrats on sending your <strong>first email</strong>!",
  text: null,
  bcc: [],
  cc: [],
  reply_to: [],
  last_event: "delivered",
  scheduled_at: null,
  tags: [{ name: "category", value: "confirm_email" }],
};

/** A mailer whose fetch answers exactly what the test wants, once. */
const mailerAnswering = (
  answer: { status?: number; body?: unknown; json?: boolean } | (() => never),
) => {
  const fetchImpl = (typeof answer === "function"
    ? (async () => answer()) 
    : (async () =>
        ({
          ok: (answer.status ?? 200) >= 200 && (answer.status ?? 200) < 300,
          status: answer.status ?? 200,
          json: async () => {
            if (answer.json === false) throw new SyntaxError("not JSON");
            return answer.body;
          },
        }) as unknown as Response)) as unknown as typeof fetch;
  return createMailer({ apiKey: "re_test", live: true, fetch: fetchImpl });
};

describe("getStatus — the happy path", () => {
  it("returns the verdict and the provider's own value for a real id", async () => {
    const s = await mailerAnswering({ body: RESEND_BODY }).getStatus(RESEND_BODY.id);
    expect(s.verdict).toBe("delivered");
    expect(s.providerStatus).toBe("delivered");
    expect(s.to).toEqual(["delivered@resend.dev"]);
    expect(s.subject).toBe("Hello World");
    expect(s.at).toBe("2026-04-03 22:13:42.674981+00");
    expect(s.reason).toBeUndefined(); // a reason belongs ONLY to `unknown`
  });

  it("calls the id-scoped endpoint with the key, using the injected fetch", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const mailer = createMailer({
      apiKey: "re_test",
      live: true,
      fetch: (async (url: string, init: RequestInit) => {
        seenUrl = String(url);
        seenAuth = String((init.headers as Record<string, string>).Authorization);
        return { ok: true, status: 200, json: async () => RESEND_BODY } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    await mailer.getStatus("id with spaces/and-slash");
    expect(seenUrl).toBe(
      "https://api.resend.com/emails/id%20with%20spaces%2Fand-slash",
    );
    expect(seenAuth).toBe("Bearer re_test");
  });
});

describe("the message BODY is dropped unless asked for", () => {
  // The provider returns the whole message here, and a status object is the
  // first thing a consumer logs. Asserting ABSENCE of the keys, not emptiness —
  // an undefined-valued key still serialises into a log line.
  it("is absent by default, even though the provider sent it", async () => {
    const s = await mailerAnswering({ body: RESEND_BODY }).getStatus("x");
    expect("html" in s).toBe(false);
    expect("text" in s).toBe(false);
  });

  it("is present when the caller opts in", async () => {
    const s = await mailerAnswering({ body: RESEND_BODY }).getStatus("x", { includeBody: true });
    expect(s.html).toBe(RESEND_BODY.html);
  });
});

describe("`to` is a FLOOR, not the recipient count", () => {
  // cardmem measured the retrieve response's real field list on two live ids,
  // with a control, on 2026-08-31:
  //   multi/suppressed 37a5ac15-…  to.length=2
  //   single/delivered 43a7af23-…  to.length=1   (without this, "2" could not be
  //                                               told from a field that always
  //                                               returns whatever was there)
  // The list carries `cc` AND `bcc`. So a guard on `to.length > 1` fires on
  // almost nothing when every letter is cc'd to one address by house rule — a
  // customer letter reads as ONE recipient and really has two. They shipped that
  // guard, measured it, and killed it themselves.
  const BODY = { ...RESEND_BODY, to: ["a@b.dk"], cc: ["cb@webhouse.dk"], bcc: ["audit@b.dk"] };

  it("counts to + cc + bcc, not to alone", async () => {
    const s = await mailerAnswering({ body: BODY }).getStatus("x");
    expect(s.to).toEqual(["a@b.dk"]);
    expect(s.cc).toEqual(["cb@webhouse.dk"]);
    expect(s.bcc).toEqual(["audit@b.dk"]);
    expect(s.recipientCount).toBe(3);
    // the trap, stated as an assertion: to.length would have said 1
    expect(s.to?.length).toBe(1);
  });

  it("does not invent a count when the provider returned no recipients at all", async () => {
    // An absent field must not read as zero — "nobody" and "not told" are
    // different answers, and zero is the one that looks like an answer.
    const { to, ...noRecipients } = BODY;
    const s = await mailerAnswering({ body: { ...noRecipients, cc: undefined, bcc: undefined } }).getStatus("x");
    expect("recipientCount" in s).toBe(false);
  });

  it("a suppressed mail is undecided regardless of the count", () => {
    // The verdict must NOT be gated on recipientCount. cardmem reached this after
    // their to.length guard failed: `suppressed` carries partial meaning whatever
    // the count says, so the strict verdict stands and the count is informational.
    expect(verdictForEvent("suppressed")).toBe("failed");
  });
});

describe("every documented event maps to exactly one verdict", () => {
  // Table-driven over ALL ELEVEN, so an event cannot pass by being absent from
  // the test. The count is asserted too: adding a type without a case here must
  // fail rather than quietly shrink the table.
  const EXPECTED: Record<MailEventType, MailVerdict> = {
    sent: "pending",
    delivered: "delivered",
    delivery_delayed: "pending",
    bounced: "failed",
    complained: "delivered",
    opened: "delivered",
    clicked: "delivered",
    failed: "failed",
    received: "unknown",
    scheduled: "pending",
    suppressed: "failed",
  };

  it("covers exactly the documented vocabulary — 11 events, no more, no fewer", () => {
    expect(MAIL_EVENT_TYPES.length).toBe(11);
    expect([...MAIL_EVENT_TYPES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))("%s → %s", (event, verdict) => {
    expect(verdictForEvent(event as MailEventType)).toBe(verdict);
  });

  // The two a repo re-rolling this would most plausibly get backwards. Named
  // separately from the table so the reason survives in the failure output.
  it("complained is DELIVERED — it arrived, then the recipient pressed spam", () => {
    expect(verdictForEvent("complained")).toBe("delivered");
  });

  it("suppressed is FAILED — it was never attempted, so waiting for it is futile", () => {
    expect(verdictForEvent("suppressed")).toBe("failed");
  });

  it("received is INBOUND and answers unknown, not a delivery", async () => {
    // Read as English, "received" looks like the strongest delivery confirmation
    // there is. Resend's own words: "Occurs whenever Resend successfully
    // receives an email" — i.e. mail arriving at YOUR inbound address.
    const s = await mailerAnswering({
      body: { ...RESEND_BODY, last_event: "received" },
    }).getStatus("x");
    expect(s.verdict).toBe("unknown");
    expect(s.reason).toMatch(/INBOUND/);
  });
});

describe("could-not-look is never reported as failure", () => {
  // Four different ways to not get an answer. The shared assertion — and the
  // load-bearing one — is that NONE of them says "failed".
  const cases: Array<[string, () => ReturnType<typeof createMailer>, RegExp]> = [
    ["a send-only key (401)", () => mailerAnswering({ status: 401, body: {} }), /NOT a delivery failure/],
    ["an id the provider does not have (404)", () => mailerAnswering({ status: 404, body: {} }), /no email with that id/],
    ["a response that is not JSON", () => mailerAnswering({ status: 200, json: false }), /not JSON/],
    ["a body with no last_event", () => mailerAnswering({ body: { id: "x" } }), /no last_event/],
  ];

  it.each(cases)("%s → unknown, with a reason", async (_name, make, reason) => {
    const s = await make().getStatus("x");
    expect(s.verdict).toBe("unknown");
    expect(s.reason).toMatch(reason);
  });

  it("a thrown network error → unknown, not a crash and not a failure", async () => {
    const mailer = createMailer({
      apiKey: "re_test",
      live: true,
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    const s = await mailer.getStatus("x");
    expect(s.verdict).toBe("unknown");
    expect(s.reason).toMatch(/could not reach the provider: ECONNREFUSED/);
  });

  it("NONE of these produces 'failed'", async () => {
    const verdicts = await Promise.all(cases.map(async ([, make]) => (await make().getStatus("x")).verdict));
    expect(verdicts).toEqual(["unknown", "unknown", "unknown", "unknown"]);
  });

  it("an event type this version does not know keeps the raw value", async () => {
    const s = await mailerAnswering({
      body: { ...RESEND_BODY, last_event: "quantum_tunnelled" },
    }).getStatus("x");
    expect(s.verdict).toBe("unknown");
    expect(s.providerStatus).toBe("quantum_tunnelled");
    expect(s.reason).toMatch(/does not know/);
  });

  it("a mailer with no key never asks, and says so", async () => {
    const s = await createMailer({}).getStatus("x");
    expect(s.verdict).toBe("unknown");
    expect(s.reason).toMatch(/no API key/);
  });

  it("every unknown carries a reason — the invariant, not one more case", async () => {
    const all = [
      await mailerAnswering({ status: 401, body: {} }).getStatus("x"),
      await mailerAnswering({ status: 404, body: {} }).getStatus("x"),
      await mailerAnswering({ status: 500, body: {} }).getStatus("x"),
      await mailerAnswering({ body: { ...RESEND_BODY, last_event: "received" } }).getStatus("x"),
      await createMailer({}).getStatus("x"),
    ];
    for (const s of all) {
      expect(s.verdict).toBe("unknown");
      expect(s.reason, JSON.stringify(s)).toBeTruthy();
    }
  });
});

describe("the webhook parser now sees the four it used to drop", () => {
  const payload = (type: string) =>
    JSON.stringify({
      type,
      created_at: "2026-08-31T00:00:00Z",
      data: { email_id: "abc", to: ["a@b.dk"] },
    });

  it.each([...MAIL_EVENT_TYPES])("email.%s parses", (type) => {
    const e = parseMailEvent(payload(`email.${type}`));
    expect(e?.type).toBe(type);
  });

  it.each(["failed", "received", "scheduled", "suppressed"])(
    "email.%s was NULL before F005.11 — measured against the published dist",
    (type) => {
      expect(parseMailEvent(payload(`email.${type}`))).not.toBeNull();
    },
  );

  it("a type the provider has not invented yet still returns null", () => {
    // Widening the vocabulary must not turn the parser into a guesser: an
    // unrecognised type still reaches onIgnored as unknown_type.
    expect(parseMailEvent(payload("email.quantum_tunnelled"))).toBeNull();
  });
});

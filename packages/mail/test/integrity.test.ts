// F005.16 — nothing broken leaves the house.
//
// Every failing case below is one sanne measured IN PRODUCTION, on a paying
// customer, within two days. None of them came from a template — which is the
// whole argument for the check living in send() rather than beside the HTML.
//
// AND EVERY PASSING CASE IS ASSERTED BY NAME, because the failure mode here is
// OVER-rejection. sanne shipped a guard that rewrote `mailto:` and `tel:` to
// `#`, breaking the two links a customer needs most. A guard that rejects too
// much gets switched off, and then it protects nothing.
import { describe, it, expect, vi } from "vitest";
import { checkMailIntegrity, describeIntegrity } from "../src/integrity";
import { createMailer } from "../src/index";

const found = (m: Parameters<typeof checkMailIntegrity>[0], check?: string) =>
  checkMailIntegrity(m).findings.filter((f) => !check || f.check === check);

describe("the three defects that reached a paying customer", () => {
  it("DEFECT 1: a relative href — Outlook reads it as a file path and the click is lost", () => {
    const f = found({ subject: "Ordre", html: '<a href="/da/shop/gavekort">Se gavekortet</a>' }, "links");
    expect(f).toHaveLength(1);
    expect(f[0]!.value).toBe("/da/shop/gavekort");
    expect(f[0]!.consequence).toContain("no domain to resolve against");
  });

  it("DEFECT 2: an unfilled placeholder — the customer received the SUBJECT LINE {{subject}}", () => {
    const f = found({ subject: "{{subject}}", html: "<p>hej</p>" }, "placeholders");
    expect(f).toHaveLength(1);
    expect(f[0]!.where).toBe("subject");
    expect(f[0]!.value).toBe("{{subject}}");
  });

  it("DEFECT 3: a cid: reference with no attachment — a broken square where the logo belongs", () => {
    const f = found({ subject: "x", html: '<img src="cid:sa-logo">' }, "attachments");
    expect(f).toHaveLength(1);
    expect(f[0]!.value).toBe("cid:sa-logo");
  });

  it("a MISTYPED content-id is caught, not only a missing attachment", () => {
    // sanne flagged this as the case that is easy to lose: it produces the
    // IDENTICAL broken square while the code reads as if everything is wired.
    // A test that only removes the attachment passes without covering it.
    const f = found(
      {
        subject: "x",
        html: '<img src="cid:sa-logoo">',
        attachments: [{ filename: "logo.png", content: "AAA", contentId: "sa-logo" }],
      },
      "attachments",
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.consequence).toContain('no attachment has contentId "sa-logoo"');
    // The remedy names what IS there, so the reader can see the typo.
    expect(f[0]!.consequence).toContain("sa-logo");
  });

  it("a placeholder in the BODY is caught too, not only in the subject", () => {
    expect(found({ subject: "ok", html: "<p>Hej {{ fornavn }}</p>" }, "placeholders")).toHaveLength(1);
    expect(found({ subject: "ok", text: "Hej {{fornavn}}" }, "placeholders")).toHaveLength(1);
  });
});

describe("BOTH DIRECTIONS — the links that must pass, by name", () => {
  // This block is the acceptance condition, not a nicety. sanne's own guard
  // broke mailto: and tel:.
  const SAFE: Array<[string, string]> = [
    ["mailto:", '<a href="mailto:sanne@example.dk">skriv</a>'],
    ["tel:", '<a href="tel:+4512345678">ring</a>'],
    ["a same-document anchor", '<a href="#priser">priser</a>'],
    ["an absolute https URL", '<a href="https://sanneandersen.dk/da/shop">shop</a>'],
    ["an absolute http URL", '<a href="http://example.dk/x">x</a>'],
    ["a scheme-relative URL", '<a href="//cdn.example.dk/x">x</a>'],
    ["sms:", '<a href="sms:+4512345678">sms</a>'],
    ["a cid: link", '<a href="cid:sa-logo">logo</a>'],
  ];

  it.each(SAFE)("%s passes untouched", (_name, html) => {
    expect(found({ subject: "ok", html, attachments: [{ filename: "l.png", content: "A", contentId: "sa-logo" }] }, "links")).toEqual([]);
  });

  it("a cid: reference WITH its attachment passes — the negative control for defect 3", () => {
    // Without this, a guard that rejected every cid: would satisfy the positive
    // test and break every mail carrying a logo.
    expect(
      found(
        {
          subject: "x",
          html: '<img src="cid:sa-logo">',
          attachments: [{ filename: "logo.png", content: "AAA", contentId: "sa-logo" }],
        },
        "attachments",
      ),
    ).toEqual([]);
  });

  it("a mail with nothing wrong reports nothing wrong", () => {
    const r = checkMailIntegrity({
      subject: "Din ordre er afsendt",
      html: '<p>Hej Sanne</p><a href="https://sanneandersen.dk/da/ordre/42">Se ordren</a><img src="cid:sa-logo">',
      attachments: [{ filename: "logo.png", content: "AAA", contentId: "sa-logo" }],
    });
    expect(r.findings).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.checked.slice().sort()).toEqual(["attachments", "links", "placeholders"]);
  });
});

describe("'nothing wrong' and 'could not check' are different answers", () => {
  it("a message with NO html reports the link check as NOT PERFORMED, never as clean", () => {
    const r = checkMailIntegrity({ subject: "hej", text: "ren tekst" });
    expect(r.findings).toEqual([]);
    expect(r.checked).not.toContain("links");
    expect(r.skipped.map((s) => s.check).sort()).toEqual(["attachments", "links"]);
  });

  it("html with no markup at all is a caller who passed plain text — also NOT PERFORMED", () => {
    const r = checkMailIntegrity({ subject: "hej", html: "bare en streng uden tags" });
    expect(r.checked).not.toContain("links");
    expect(r.skipped.find((s) => s.check === "links")!.reason).toContain("no markup");
  });

  it("…and the placeholder check still RUNS on a text-only mail", () => {
    // A text-only mail is an ordinary mail. Skipping every check because one
    // cannot run would be the opposite over-correction.
    const r = checkMailIntegrity({ subject: "{{subject}}", text: "hej" });
    expect(r.checked).toContain("placeholders");
    expect(r.findings).toHaveLength(1);
  });

  it("describeIntegrity SAYS what was not checked, even with zero findings", () => {
    const line = describeIntegrity(checkMailIntegrity({ subject: "hej", text: "ren tekst" }));
    expect(line).toContain("NOT CHECKED");
  });
});

describe("enforcement is a MAILER-level decision, read back like `mode`", () => {
  const mailer = (integrity?: "report-only" | "enforcing") =>
    createMailer({
      apiKey: "re_test",
      from: "Sanne <noreply@send.example.dk>",
      live: true,
      integrity,
      logger: () => {},
      fetch: vi.fn(async () => new Response(JSON.stringify({ id: "m1" }), { status: 200 })) as unknown as typeof fetch,
    });

  const broken = { to: "kunde@example.dk", subject: "Ordre", html: '<a href="/da/shop">shop</a>' };

  it("REPORT-ONLY IS THE DEFAULT ON ARRIVAL: upgrading blocks nobody's mail", () => {
    // send() is the fleet's single chokepoint. A guard too strict here does not
    // break one app — it stops every app at once.
    expect(mailer().integrity).toBe("not-configured");
  });

  it("…and a not-configured mailer SENDS a mail that would have been blocked", async () => {
    const r = await mailer().send(broken);
    expect(r.ok).toBe(true);
    expect(r.id).toBe("m1");
  });

  it("'I could not determine it' never renders as report-only", () => {
    // Three values, and the third is the point: a consumer asserting
    // `integrity === "enforcing"` before deleting its own guard is asking a
    // question that can only be answered wrongly in one direction.
    expect(mailer().integrity).not.toBe("report-only");
    expect(mailer("report-only").integrity).toBe("report-only");
    expect(mailer("enforcing").integrity).toBe("enforcing");
  });

  it("report-only SENDS and does not block", async () => {
    const r = await mailer("report-only").send(broken);
    expect(r.ok).toBe(true);
  });

  it("enforcing REFUSES, and the error names the value and the consequence", async () => {
    const r = await mailer("enforcing").send(broken);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("integrity:");
    expect(r.error).toContain("/da/shop");
    expect(r.error).toContain("no domain to resolve against");
  });

  it("NEGATIVE CONTROL: an enforcing mailer still sends a CLEAN mail", async () => {
    // Without this, a guard that refused everything would pass the test above
    // and stop the fleet's mail entirely.
    const r = await mailer("enforcing").send({
      to: "kunde@example.dk",
      subject: "Ordre",
      html: '<a href="https://sanneandersen.dk/da/shop">shop</a>',
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe("m1");
  });
});

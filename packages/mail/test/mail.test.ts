import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALWAYS_ALLOWED,
  buildFrom,
  createMailer,
  createMailerFromEnv,
  mailAllowed,
} from "../src/index";

function okFetch(id = "msg_1") {
  return vi.fn(async () => new Response(JSON.stringify({ id }), { status: 200 })) as unknown as typeof fetch;
}

/** A fetch that records each Resend payload so tests can assert on the body sent. */
function captureFetch() {
  const calls: Record<string, any>[] = [];
  const f = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "msg" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("buildFrom", () => {
  it("composes Name <addr> and passes a bare address through", () => {
    expect(buildFrom("Sanne Andersen", "noreply@webhouse.dk")).toBe(
      "Sanne Andersen <noreply@webhouse.dk>",
    );
    expect(buildFrom(undefined, "x81@webhouse.dk")).toBe("x81@webhouse.dk");
  });
});

describe("mailAllowed", () => {
  it("passes everything when live", () => {
    expect(mailAllowed("anyone@example.com", { live: true })).toBe(true);
  });
  it("requires every recipient in allowlist when not live", () => {
    expect(mailAllowed("user@example.com", { allowlist: ["user@example.com"] })).toBe(true);
    expect(mailAllowed(["user@example.com", "other@example.com"], { allowlist: ["user@example.com"] })).toBe(false);
  });
  it("always allows the fleet admins (case-insensitive)", () => {
    expect(mailAllowed("CB@webhouse.dk", {})).toBe(true);
    for (const a of ALWAYS_ALLOWED) expect(mailAllowed(a, {})).toBe(true);
  });
  it("empty recipient list is not allowed", () => {
    expect(mailAllowed([], {})).toBe(false);
  });
});

describe("createMailer.send", () => {
  it("ship-dark: no apiKey ⇒ logged no-op, never calls fetch", async () => {
    const f = okFetch();
    const log = vi.fn();
    const mailer = createMailer({ from: "noreply@webhouse.dk", fetch: f, logger: log });
    const r = await mailer.send({ to: "a@b.dk", subject: "hi", html: "<p>x</p>" });
    const { integrity, ...rest } = r; // F005.18: the report now rides along; the rest is still exact
    expect(rest).toEqual({ ok: true, skipped: true, reason: "no-key" });
    expect(integrity).toBeDefined();
    expect(f).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("disabled ⇒ logged no-op, never calls fetch", async () => {
    const f = okFetch();
    const mailer = createMailer({ apiKey: "re_x", from: "noreply@webhouse.dk", disabled: true, fetch: f });
    const r = await mailer.send({ to: "a@b.dk", subject: "hi" });
    expect(r.skipped).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("not live + recipient not allowlisted ⇒ skipped, no fetch", async () => {
    const f = okFetch();
    const mailer = createMailer({ apiKey: "re_x", from: "noreply@webhouse.dk", live: false, fetch: f });
    const r = await mailer.send({ to: "real-user@example.com", subject: "hi" });
    expect(r.skipped).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("not live but recipient is a fleet admin ⇒ really sends", async () => {
    const f = okFetch("msg_admin");
    const mailer = createMailer({ apiKey: "re_x", from: "noreply@webhouse.dk", live: false, fetch: f });
    const r = await mailer.send({ to: "cb@webhouse.dk", subject: "hi" });
    const { integrity: i1, ...r1 } = r;
    expect(r1).toEqual({ ok: true, id: "msg_admin" });
    expect(i1).toBeDefined();
    expect(f).toHaveBeenCalledOnce();
  });

  it("live send posts to Resend with bearer + maps replyTo→reply_to", async () => {
    const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.resend.com/emails");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer re_live");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        from: "Sanne <noreply@webhouse.dk>",
        to: "u@example.com",
        subject: "Booking",
        html: "<p>ok</p>",
        text: "ok",
        reply_to: "reply@webhouse.dk",
      });
      expect(body.replyTo).toBeUndefined();
      return new Response(JSON.stringify({ id: "msg_live" }), { status: 200 });
    }) as unknown as typeof fetch;
    const mailer = createMailer({ apiKey: "re_live", from: "noreply@webhouse.dk", fromName: "Sanne", live: true, fetch: f });
    const r = await mailer.send({
      to: "u@example.com",
      subject: "Booking",
      html: "<p>ok</p>",
      text: "ok",
      replyTo: "reply@webhouse.dk",
    });
    const { integrity: i2, ...r2 } = r;
    expect(r2).toEqual({ ok: true, id: "msg_live" });
    expect(i2).toBeDefined();
  });

  it("FAIL-SAFE (0.3.0): key present but live UNSET ⇒ a real recipient is held back (skipped), not mass-sent", async () => {
    const f = okFetch();
    const log = vi.fn();
    const mailer = createMailer({ apiKey: "re_x", from: "noreply@webhouse.dk", fetch: f, logger: log });
    const r = await mailer.send({ to: "real-user@example.com", subject: "hi" });
    expect(r.skipped).toBe(true); // would have SENT under the old !!apiKey default
    expect(f).not.toHaveBeenCalled();
    // and it warns at creation that real recipients are being held back
    expect(log).toHaveBeenCalledWith(expect.stringContaining("live not set"));
  });

  it("FAIL-SAFE: key present, live unset, but a fleet admin recipient still goes through", async () => {
    const f = okFetch("msg_admin");
    const mailer = createMailer({ apiKey: "re_x", from: "noreply@webhouse.dk", fetch: f });
    const r = await mailer.send({ to: "christian@broberg.ai", subject: "hi" });
    const { integrity: i3, ...r3 } = r;
    expect(r3).toEqual({ ok: true, id: "msg_admin" });
    expect(i3).toBeDefined();
  });

  it("message.from overrides the mailer default", async () => {
    const f = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).from).toBe("Override <o@webhouse.dk>");
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }) as unknown as typeof fetch;
    const mailer = createMailer({ apiKey: "re_x", from: "noreply@webhouse.dk", live: true, fetch: f });
    await mailer.send({ to: "u@example.com", subject: "s", from: "Override <o@webhouse.dk>" });
  });

  it("encodes attachment bytes to base64 + maps contentId→content_id", async () => {
    const f = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const att = JSON.parse(String(init?.body)).attachments[0];
      expect(att).toEqual({
        filename: "a.ics",
        content: Buffer.from("BEGIN").toString("base64"),
        content_type: "text/calendar",
        content_id: "cal",
      });
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }) as unknown as typeof fetch;
    const mailer = createMailer({ apiKey: "re_x", from: "n@webhouse.dk", live: true, fetch: f });
    await mailer.send({
      to: "u@example.com",
      subject: "s",
      attachments: [
        { filename: "a.ics", content: new TextEncoder().encode("BEGIN"), contentType: "text/calendar", contentId: "cal" },
      ],
    });
  });

  it("upstream error ⇒ {ok:false, error} from Resend message", async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ name: "validation_error", message: "Invalid `to` field" }), { status: 422 }),
    ) as unknown as typeof fetch;
    const mailer = createMailer({ apiKey: "re_x", from: "n@webhouse.dk", live: true, fetch: f });
    const r = await mailer.send({ to: "bad", subject: "s" });
    const { integrity: i4, ...r4 } = r;
    expect(r4).toEqual({ ok: false, error: "Invalid `to` field" });
    expect(i4).toBeDefined(); // a provider failure carries it too — absence must never have two meanings
  });

  it("fetch throwing ⇒ {ok:false, error} (never throws)", async () => {
    const f = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const mailer = createMailer({ apiKey: "re_x", from: "n@webhouse.dk", live: true, fetch: f });
    const r = await mailer.send({ to: "u@example.com", subject: "s" });
    const { integrity: i5, ...r5 } = r;
    expect(r5).toEqual({ ok: false, error: "network down" });
    expect(i5).toBeDefined();
  });

  it("missing from ⇒ {ok:false, error: no_from}", async () => {
    const mailer = createMailer({ apiKey: "re_x", live: true, fetch: okFetch() });
    const r = await mailer.send({ to: "u@example.com", subject: "s" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no_from");
  });
});

describe("createMailer.send — MailID correlation footer (F040.1)", () => {
  const base = { apiKey: "re_x", from: "n@webhouse.dk", live: true } as const;

  it("no mailId ⇒ body is sent unchanged (backward compatible)", async () => {
    const { f, calls } = captureFetch();
    await createMailer({ ...base, fetch: f }).send({
      to: "u@example.com",
      subject: "s",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(calls[0].html).toBe("<p>hi</p>");
    expect(calls[0].text).toBe("hi");
  });

  it("config.mailId ⇒ a real, faint 'Ref: <token>' footer is appended to html + text", async () => {
    const { f, calls } = captureFetch();
    await createMailer({ ...base, mailId: "CM-abc123", fetch: f }).send({
      to: "u@example.com",
      subject: "s",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(calls[0].html).toContain("Ref: CM-abc123");
    expect(calls[0].text).toContain("Ref: CM-abc123");
    // real, visible text — never display:none / white-on-white (stripped on reply + spam-flagged)
    expect(calls[0].html).not.toMatch(/display\s*:\s*none/i);
    expect(calls[0].html).toContain("color:#9ca3af");
    // original content preserved
    expect(calls[0].html).toContain("<p>hi</p>");
    expect(calls[0].text.startsWith("hi")).toBe(true);
  });

  it("message.mailId overrides config.mailId for that send", async () => {
    const { f, calls } = captureFetch();
    await createMailer({ ...base, mailId: "CM-config", fetch: f }).send({
      to: "u@example.com",
      subject: "s",
      text: "hi",
      mailId: "CM-override",
    });
    expect(calls[0].text).toContain("Ref: CM-override");
    expect(calls[0].text).not.toContain("CM-config");
  });

  it("idempotent ⇒ a body already carrying the token is not double-stamped", async () => {
    const { f, calls } = captureFetch();
    await createMailer({ ...base, mailId: "CM-once", fetch: f }).send({
      to: "u@example.com",
      subject: "s",
      html: "<p>hi</p><span>Ref: CM-once</span>",
    });
    expect(calls[0].html.match(/CM-once/g)).toHaveLength(1);
  });

  it("inserts the footer just before </body> in a full html document", async () => {
    const { f, calls } = captureFetch();
    await createMailer({ ...base, mailId: "CM-doc", fetch: f }).send({
      to: "u@example.com",
      subject: "s",
      html: "<html><body><p>hi</p></body></html>",
    });
    const html = calls[0].html as string;
    expect(html.indexOf("CM-doc")).toBeLessThan(html.indexOf("</body>"));
  });

  it("only stamps the body parts that exist (html-only ⇒ no text part invented)", async () => {
    const { f, calls } = captureFetch();
    await createMailer({ ...base, mailId: "CM-htmlonly", fetch: f }).send({
      to: "u@example.com",
      subject: "s",
      html: "<p>hi</p>",
    });
    expect(calls[0].html).toContain("CM-htmlonly");
    expect(calls[0].text).toBeUndefined();
  });

  it("the token survives plain-text in a quoted reply (the routing property)", async () => {
    const { f, calls } = captureFetch();
    await createMailer({ ...base, mailId: "CM-reply7", fetch: f }).send({
      to: "u@example.com",
      subject: "s",
      text: "Hello",
    });
    const sent = calls[0].text as string;
    // a typical reply quotes the original beneath the new text
    const reply = `Thanks!\n\nOn Mon someone wrote:\n> ${sent.split("\n").join("\n> ")}`;
    expect(reply).toContain("CM-reply7"); // cardmem's body substring-match would find it
  });
});

describe("createMailerFromEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads MAIL_ID into the correlation footer", async () => {
    process.env.RESEND_API_KEY = "re_env";
    process.env.MAIL_FROM = "n@webhouse.dk";
    process.env.MAIL_LIVE = "true";
    process.env.MAIL_ID = "CM-env9";
    const { f, calls } = captureFetch();
    await createMailerFromEnv({ fetch: f }).send({ to: "u@example.com", subject: "s", text: "hi" });
    expect(calls[0].text).toContain("Ref: CM-env9");
  });

  it("reads RESEND_API_KEY / MAIL_FROM / MAIL_ALLOWLIST and gates accordingly", async () => {
    process.env.RESEND_API_KEY = "re_env";
    process.env.MAIL_FROM = "noreply@webhouse.dk";
    process.env.MAIL_FROM_NAME = "Fleet";
    process.env.MAIL_LIVE = "false";
    process.env.MAIL_ALLOWLIST = "team@webhouse.dk";
    const f = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).from).toBe("Fleet <noreply@webhouse.dk>");
      return new Response(JSON.stringify({ id: "env" }), { status: 200 });
    }) as unknown as typeof fetch;
    const mailer = createMailerFromEnv({ fetch: f });
    expect((await mailer.send({ to: "stranger@example.com", subject: "s" })).skipped).toBe(true);
    expect((await mailer.send({ to: "team@webhouse.dk", subject: "s" })).id).toBe("env");
  });
});

describe("F005.18 — the check runs where it is cheap, enforcement where it matters", () => {
  /**
   * FILED BY sanne (#27435) out of their own cutover. Before this, send() ran
   * checkMailIntegrity BELOW both skip gates — so it never fired without an API
   * key (dev, CI) or for a recipient off the allowlist (staging). Those are the
   * three places a broken template is cheapest to find. Their test with no key
   * got `{ ok: true, skipped: true }` for a BROKEN mail and proved nothing.
   */

  /** A mail with a relative href — a real finding, not a synthetic one. */
  const broken = { to: "nobody@example.com", subject: "S", html: '<p><a href="/kontakt">k</a></p>' };

  it("a mailer with NO key still reports the finding — the whole card", async () => {
    const f = okFetch();
    const r = await createMailer({ from: "n@webhouse.dk", fetch: f }).send(broken);

    expect(r.skipped).toBe(true);
    expect(f).not.toHaveBeenCalled();
    // Before F005.18 this was undefined: the check never ran.
    expect(r.integrity?.findings).toHaveLength(1);
    expect(r.integrity?.findings[0]?.check).toBe("links");
  });

  it("…and so does one whose recipient is off the allowlist", async () => {
    const f = okFetch();
    const r = await createMailer({ apiKey: "re_x", from: "n@webhouse.dk", live: false, fetch: f }).send(broken);

    expect(r.skipped).toBe(true);
    expect(f).not.toHaveBeenCalled();
    expect(r.integrity?.findings).toHaveLength(1);
  });

  it("A SKIP IS NEVER REFUSED, not even under enforcing", async () => {
    // The rule that keeps this fix from being a worse outage than the bug: a dev
    // machine that starts answering { ok: false } where it used to no-op would
    // break every consumer at once, and the mail was never going out anyway.
    for (const config of [
      { from: "n@webhouse.dk" },                                  // no key
      { apiKey: "re_x", from: "n@webhouse.dk", disabled: true },  // disabled
      { apiKey: "re_x", from: "n@webhouse.dk", live: false },     // not live
    ]) {
      const r = await createMailer({ ...config, integrity: "enforcing", fetch: okFetch() }).send(broken);
      expect(r.ok, JSON.stringify(config)).toBe(true);
      expect(r.skipped, JSON.stringify(config)).toBe(true);
      expect(r.error, JSON.stringify(config)).toBeUndefined();
    }
  });

  it("…while a REAL delivery under enforcing is still refused", async () => {
    // The negative control for the test above: if enforcement had been lost
    // rather than scoped, that test would pass for the wrong reason.
    const f = okFetch();
    const r = await createMailer({
      apiKey: "re_x", from: "n@webhouse.dk", live: true, integrity: "enforcing", fetch: f,
    }).send(broken);

    expect(r.ok).toBe(false);
    expect(r.error).toContain("integrity:");
    expect(f).not.toHaveBeenCalled();
  });

  it("THREE CAUSES, THREE REASONS — each from the config that produces it", async () => {
    const clean = { to: "cb@webhouse.dk", subject: "S", html: "<p>hej</p>" };
    const cases: [string, Parameters<typeof createMailer>[0]][] = [
      ["no-key", { from: "n@webhouse.dk" }],
      ["disabled", { apiKey: "re_x", from: "n@webhouse.dk", disabled: true }],
      ["not-live", { apiKey: "re_x", from: "n@webhouse.dk", live: false }],
    ];
    for (const [want, config] of cases) {
      // not-live needs a recipient OFF the allowlist to reach that gate.
      const to = want === "not-live" ? "stranger@example.com" : clean.to;
      const r = await createMailer({ ...config, fetch: okFetch() }).send({ ...clean, to });
      expect(r.reason, want).toBe(want);
    }
  });

  it("THE DANGEROUS ONE is distinguishable from ship-dark at the call site", async () => {
    // sanne's measured near-miss: a key IS set, so the caller believes mail is
    // on, and every customer mail quietly stops at the allowlist. Booking
    // confirmations, Stripe receipts and magic links, all answering ok:true.
    const configured = await createMailer({
      apiKey: "re_live_looking", from: "n@webhouse.dk", fetch: okFetch(),
    }).send({ to: "customer@example.com", subject: "Din booking", html: "<p>hej</p>" });

    const darkShip = await createMailer({ from: "n@webhouse.dk", fetch: okFetch() })
      .send({ to: "customer@example.com", subject: "Din booking", html: "<p>hej</p>" });

    expect(configured.reason).toBe("not-live");
    expect(darkShip.reason).toBe("no-key");
    expect(configured.reason).not.toBe(darkShip.reason); // the whole point
  });

  it("ADDITIVE ONLY: a consumer reading only the old fields cannot tell this shipped", async () => {
    const clean = { to: "cb@webhouse.dk", subject: "S", html: "<p>hej</p>" };
    const old = (r: Awaited<ReturnType<ReturnType<typeof createMailer>["send"]>>) =>
      ({ ok: r.ok, id: r.id, error: r.error, skipped: r.skipped });

    expect(old(await createMailer({ from: "n@webhouse.dk", fetch: okFetch() }).send(clean)))
      .toEqual({ ok: true, id: undefined, error: undefined, skipped: true });
    expect(old(await createMailer({ apiKey: "re_x", from: "n@webhouse.dk", disabled: true, fetch: okFetch() }).send(clean)))
      .toEqual({ ok: true, id: undefined, error: undefined, skipped: true });
    expect(old(await createMailer({ apiKey: "re_x", from: "n@webhouse.dk", live: false, fetch: okFetch() }).send({ ...clean, to: "stranger@example.com" })))
      .toEqual({ ok: true, id: undefined, error: undefined, skipped: true });
    expect(old(await createMailer({ apiKey: "re_x", from: "n@webhouse.dk", live: true, fetch: okFetch("msg_9") }).send(clean)))
      .toEqual({ ok: true, id: "msg_9", error: undefined, skipped: undefined });
  });

  it("a DELIVERED mail carries the report too, so absence never has two meanings", async () => {
    const r = await createMailer({
      apiKey: "re_x", from: "n@webhouse.dk", live: true, fetch: okFetch(),
    }).send({ to: "customer@example.com", subject: "S", html: "<p>hej</p>" });

    expect(r.ok).toBe(true);
    expect(r.integrity?.checked).toContain("links");
  });
});

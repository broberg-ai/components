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
    expect(r).toEqual({ ok: true, skipped: true });
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
    expect(r).toEqual({ ok: true, id: "msg_admin" });
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
    const mailer = createMailer({ apiKey: "re_live", from: "noreply@webhouse.dk", fromName: "Sanne", fetch: f });
    const r = await mailer.send({
      to: "u@example.com",
      subject: "Booking",
      html: "<p>ok</p>",
      text: "ok",
      replyTo: "reply@webhouse.dk",
    });
    expect(r).toEqual({ ok: true, id: "msg_live" });
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
    expect(r).toEqual({ ok: false, error: "Invalid `to` field" });
  });

  it("fetch throwing ⇒ {ok:false, error} (never throws)", async () => {
    const f = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const mailer = createMailer({ apiKey: "re_x", from: "n@webhouse.dk", live: true, fetch: f });
    const r = await mailer.send({ to: "u@example.com", subject: "s" });
    expect(r).toEqual({ ok: false, error: "network down" });
  });

  it("missing from ⇒ {ok:false, error: no_from}", async () => {
    const mailer = createMailer({ apiKey: "re_x", live: true, fetch: okFetch() });
    const r = await mailer.send({ to: "u@example.com", subject: "s" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no_from");
  });
});

describe("createMailerFromEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
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

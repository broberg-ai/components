import { describe, expect, it, vi } from "vitest";
import { createMailer } from "../src/index";
import { buildMime, gmailTransport } from "../src/gmail";

/**
 * F005.20 — a Gmail transport behind the same chokepoint, so a mail can be
 * sent AS the user, in their own thread, from their own Sent folder.
 */

const TOKEN = "ya29.SECRET-token-value";
const decode = (raw: string) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function fakeGmail(o: { status?: number; body?: unknown } = {}) {
  const calls: Array<{ url: string; auth: string; body: { raw: string; threadId?: string } }> = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(o.body ?? { id: "g-msg-1", threadId: "t-1" }), { status: o.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const gmail = (g: ReturnType<typeof fakeGmail>, getAccessToken = async () => TOKEN) => gmailTransport({ getAccessToken, fetch: g.fetchFn });

describe("the transport seam", () => {
  it("without a transport the Resend request is byte-identical to before", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const f = vi.fn(async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify({ id: "r1" })); }) as unknown as typeof fetch;
    const r = await createMailer({ apiKey: "re_x", live: true, from: "a@x.dk", fetch: f }).send({ to: "b@y.dk", subject: "Hej", text: "t", threadId: "ignored", inReplyTo: "<m@x>" });
    expect(r).toMatchObject({ ok: true, id: "r1" });
    expect(seen[0]!.url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ from: "a@x.dk", to: "b@y.dk", subject: "Hej", text: "t" });
  });

  it("a transport makes the mailer live without a Resend key — and never calls Resend", async () => {
    const g = fakeGmail();
    const m = createMailer({ transport: gmail(g), live: true, from: "ejer@x.dk" });
    expect(m.mode).toBe("live");
    const r = await m.send({ to: "kunde@y.dk", subject: "Re: Møde", text: "Fredag passer.", threadId: "t-1", inReplyTo: "<abc@y.dk>" });
    expect(r).toMatchObject({ ok: true, id: "g-msg-1", threadId: "t-1" });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]!.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(g.calls[0]!.body.threadId).toBe("t-1");
  });
});

describe("every gate stands in front of the transport", () => {
  it("disabled → the transport is never called", async () => {
    const g = fakeGmail();
    const r = await createMailer({ transport: gmail(g), live: true, disabled: true, from: "a@x.dk" }).send({ to: "b@y.dk", subject: "s", text: "t" });
    expect(r).toMatchObject({ ok: true, skipped: true, reason: "disabled" });
    expect(g.calls).toHaveLength(0);
  });
  it("not live and not allowlisted → the transport is never called", async () => {
    const g = fakeGmail();
    const r = await createMailer({ transport: gmail(g), from: "a@x.dk" }).send({ to: "stranger@y.dk", subject: "s", text: "t" });
    expect(r).toMatchObject({ ok: true, skipped: true, reason: "not-live" });
    expect(g.calls).toHaveLength(0);
  });
  it("integrity enforcing → a broken mail is refused before the transport", async () => {
    const g = fakeGmail();
    const r = await createMailer({ transport: gmail(g), live: true, integrity: "enforcing", from: "a@x.dk" }).send({ to: "b@y.dk", subject: "s", html: '<p>Hej {{name}}</p><img src="cid:missing">' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^integrity:/);
    expect(g.calls).toHaveLength(0);
  });
});

describe("the message Gmail receives", () => {
  it("threads: In-Reply-To + References, subject and non-ASCII names encoded", async () => {
    const g = fakeGmail();
    await createMailer({ transport: gmail(g), live: true, from: "Søren <ejer@x.dk>" }).send({ to: "Åse Kunde <kunde@y.dk>", subject: "Re: Møde på fredag", text: "Fredag passer fint.", inReplyTo: "<abc@y.dk>", references: "<root@y.dk>" });
    const mime = decode(g.calls[0]!.body.raw);
    expect(mime).toContain("In-Reply-To: <abc@y.dk>\r\n");
    expect(mime).toContain("References: <root@y.dk> <abc@y.dk>\r\n");
    expect(mime).toContain(`From: =?UTF-8?B?${Buffer.from("Søren").toString("base64")}?= <ejer@x.dk>`);
    expect(mime).toContain(`To: =?UTF-8?B?${Buffer.from("Åse Kunde").toString("base64")}?= <kunde@y.dk>`);
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from("Re: Møde på fredag").toString("base64")}?=`);
    expect(Buffer.from(mime.split("\r\n\r\n")[1]!, "base64").toString("utf8")).toBe("Fredag passer fint.");
  });
  it("html + text become multipart/alternative with both parts intact", () => {
    const mime = buildMime({ from: "a@x.dk", message: { to: "b@y.dk", subject: "s" }, html: "<p>æ</p>", text: "æ" }, "BND");
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="BND"');
    const parts = mime.split("--BND").slice(1, 3).map((p) => Buffer.from(p.split("\r\n\r\n")[1]!.trim(), "base64").toString("utf8"));
    expect(parts).toEqual(["æ", "<p>æ</p>"]);
  });
  it("a line break in a raw header value is refused, never stripped", async () => {
    const g = fakeGmail();
    const r = await createMailer({ transport: gmail(g), live: true, from: "a@x.dk" }).send({ to: "b@y.dk", subject: "s", text: "t", inReplyTo: "<a@b>\r\nBcc: evil@z.dk" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/In-Reply-To.*line break/);
    expect(g.calls).toHaveLength(0);
  });
  it("a line break in the subject is encoded inside one word — no header can be smuggled", () => {
    const mime = buildMime({ from: "a@x.dk", message: { to: "b@y.dk", subject: "Hej\r\nBcc: evil@z.dk" }, text: "t" });
    expect(mime.split("\r\n").filter((l) => l.startsWith("Bcc:"))).toEqual([]);
  });
  it("attachments are refused with a reason, not silently dropped", async () => {
    const g = fakeGmail();
    const r = await createMailer({ transport: gmail(g), live: true, from: "a@x.dk" }).send({ to: "b@y.dk", subject: "s", text: "t", attachments: [{ filename: "a.txt", content: "eA==" }] });
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/attachments/);
  });
});

describe("the token never leaves", () => {
  it("an error body that echoes the token is redacted", async () => {
    const g = fakeGmail({ status: 401, body: { error: { message: `Invalid Credentials for ${TOKEN}` } } });
    const logs: string[] = [];
    const r = await createMailer({ transport: gmail(g), live: true, from: "a@x.dk", logger: (m, meta) => logs.push(m + JSON.stringify(meta ?? "")) }).send({ to: "b@y.dk", subject: "s", text: "t" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("gmail_http_401");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(logs.join("\n")).not.toContain(TOKEN);
  });
  it("a token provider that throws with the secret in its message leaks nothing", async () => {
    const g = fakeGmail();
    const r = await createMailer({ transport: gmail(g, async () => { throw new Error(`refresh failed for ${TOKEN}`); }), live: true, from: "a@x.dk" }).send({ to: "b@y.dk", subject: "s", text: "t" });
    expect(r).toMatchObject({ ok: false, error: "gmail: no access token (Error)" });
    expect(g.calls).toHaveLength(0);
  });
  it("the token is sent only as the bearer header", async () => {
    const g = fakeGmail();
    await createMailer({ transport: gmail(g), live: true, from: "a@x.dk" }).send({ to: "b@y.dk", subject: "s", text: "t" });
    expect(g.calls[0]!.auth).toBe(`Bearer ${TOKEN}`);
    expect(decode(g.calls[0]!.body.raw)).not.toContain(TOKEN);
  });
});

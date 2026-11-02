// F005.23 — deliveryStatus against a fake Resend /emails list holding several projects' mail.
import { describe, expect, it } from "vitest";
import { deliveryStatus } from "../src/delivery";

const mail = (id: string, to: string | string[], from: string, created_at: string, last_event = "delivered", subject = "s") =>
  ({ object: "email", id, to: Array.isArray(to) ? to : [to], from, created_at, last_event, subject });

function fakeResend(pages: { data: unknown[]; has_more: boolean }[] | number) {
  const urls: string[] = [];
  const auths: string[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    auths.push((init?.headers as Record<string, string>)?.Authorization ?? "");
    if (typeof pages === "number") return new Response(JSON.stringify({ message: "no" }), { status: pages });
    const p = pages[urls.length - 1] ?? { data: [], has_more: false };
    return new Response(JSON.stringify({ object: "list", ...p }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, urls, auths };
}

const PAGE1 = {
  has_more: true,
  data: [
    mail("e5", "Mette@Example.dk", "FD Sundhed <login@fdaalborg.dk>", "2026-10-22 10:00:00.000+00", "delivered", "Din login-kode"),
    mail("e4", "ole@example.dk", "BID <noreply@broberg.ai>", "2026-10-22 09:00:00.000+00"),
    mail("e3", ["mette@example.dk", "x@y.dk"], "Beacon <hi@beacon.broberg.ai>", "2026-10-21 12:00:00.000+00", "bounced", "Beacon"),
  ],
};
const PAGE2 = {
  has_more: false,
  data: [
    mail("e2", "mette@example.dk", "FD Sundhed <login@fdaalborg.dk>", "2026-10-20 08:00:00.000+00", "sent", "Gammel kode"),
    mail("e1", "mette@example.dk", "FD Sundhed <login@fdaalborg.dk>", "2026-10-01 08:00:00.000+00", "delivered", "Meget gammel"),
  ],
};

describe("deliveryStatus (F005.23)", () => {
  it("returns exactly the mails to that recipient — never another project's — across two pages", async () => {
    const f = fakeResend([PAGE1, PAGE2]);
    const r = await deliveryStatus({ to: "mette@example.dk" }, { apiKey: "re_x", fetch: f.impl });
    expect(r).toEqual({
      ok: true,
      truncated: false,
      mails: [
        { id: "e5", createdAt: "2026-10-22 10:00:00.000+00", lastEvent: "delivered", to: ["Mette@Example.dk"], from: "FD Sundhed <login@fdaalborg.dk>", subject: "Din login-kode" },
        { id: "e3", createdAt: "2026-10-21 12:00:00.000+00", lastEvent: "bounced", to: ["mette@example.dk", "x@y.dk"], from: "Beacon <hi@beacon.broberg.ai>", subject: "Beacon" },
        { id: "e2", createdAt: "2026-10-20 08:00:00.000+00", lastEvent: "sent", to: ["mette@example.dk"], from: "FD Sundhed <login@fdaalborg.dk>", subject: "Gammel kode" },
        { id: "e1", createdAt: "2026-10-01 08:00:00.000+00", lastEvent: "delivered", to: ["mette@example.dk"], from: "FD Sundhed <login@fdaalborg.dk>", subject: "Meget gammel" },
      ],
    });
    expect(f.urls).toEqual(["https://api.resend.com/emails?limit=100", "https://api.resend.com/emails?limit=100&after=e3"]);
    expect(f.auths).toEqual(["Bearer re_x", "Bearer re_x"]);
  });

  it("from narrows to one sender (address or «Name <address>»)", async () => {
    const r = await deliveryStatus({ to: "mette@example.dk", from: "login@fdaalborg.dk" }, { apiKey: "re_x", fetch: fakeResend([PAGE1, PAGE2]).impl });
    expect(r.ok && r.mails.map((m) => m.id)).toEqual(["e5", "e2", "e1"]);
  });

  it("since: older mails are left out and paging STOPS once since is passed", async () => {
    const f = fakeResend([{ ...PAGE1, data: [...PAGE1.data, mail("e2b", "mette@example.dk", "a@b.dk", "2026-10-20 08:00:00.000+00")] }, PAGE2]);
    const r = await deliveryStatus({ to: "mette@example.dk", since: new Date("2026-10-21T00:00:00Z") }, { apiKey: "re_x", fetch: f.impl });
    expect(r.ok && r.mails.map((m) => m.id)).toEqual(["e5", "e3"]);
    expect(f.urls).toHaveLength(1);
  });

  it("a send-only key (401 or 403) is read_not_permitted — never an empty list", async () => {
    for (const status of [401, 403]) {
      const r = await deliveryStatus({ to: "mette@example.dk" }, { apiKey: "re_x", fetch: fakeResend(status).impl });
      expect([status, r.ok, !r.ok && r.reason]).toEqual([status, false, "read_not_permitted"]);
    }
  });

  it("no key, no recipient, or a provider error are could_not_ask — never ok", async () => {
    expect(await deliveryStatus({ to: "a@b.dk" }, { fetch: fakeResend([PAGE1]).impl })).toMatchObject({ ok: false, reason: "could_not_ask" });
    expect(await deliveryStatus({ to: " " }, { apiKey: "re_x", fetch: fakeResend([PAGE1]).impl })).toMatchObject({ ok: false, reason: "could_not_ask" });
    expect(await deliveryStatus({ to: "a@b.dk" }, { apiKey: "re_x", fetch: fakeResend(500).impl })).toMatchObject({ ok: false, reason: "could_not_ask" });
  });
});

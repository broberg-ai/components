// F005.6 — the send receipt must survive the request that made it.
import { describe, expect, it, vi } from "vitest";
import { createMailer, type MailOutcomeEntry } from "../src/index.js";

const ok = (id = "re_1") => vi.fn(async () => new Response(JSON.stringify({ id }), { status: 200 }));
const live = (onResult: (e: MailOutcomeEntry) => void, fetch = ok()) =>
  createMailer({ apiKey: "re_test", from: "noreply@send.broberg.ai", live: true, fetch, onResult, logger: () => {} });

describe("onResult — one receipt per recipient, every outcome (F005.6)", () => {
  it("fires on SUCCESS — the outcome that used to emit nothing", async () => {
    const seen: MailOutcomeEntry[] = [];
    const r = await live((e) => seen.push(e)).send({ to: "a@x.dk", subject: "s", text: "t", tenant: "t1" });
    expect(r.ok).toBe(true);
    expect(seen).toStrictEqual([{ to: "a@x.dk", outcome: "sent", providerId: "re_1", tenant: "t1" }]);
  });

  it("is called BEFORE send() returns", async () => {
    const order: string[] = [];
    await live(() => order.push("sink")).send({ to: "a@x.dk", subject: "s", text: "t" }).then(() => order.push("returned"));
    expect(order).toStrictEqual(["sink", "returned"]);
  });

  it("a SKIP is first-class and carries its reason (not-live / no-key / disabled)", async () => {
    const seen: MailOutcomeEntry[] = [];
    const sink = (e: MailOutcomeEntry): void => { seen.push(e); };
    await createMailer({ apiKey: "re_test", from: "n@send.broberg.ai", onResult: sink, logger: () => {}, fetch: ok() }).send({ to: "stranger@x.dk", subject: "s", text: "t" });
    await createMailer({ from: "n@send.broberg.ai", onResult: sink, logger: () => {} }).send({ to: "b@x.dk", subject: "s", text: "t" });
    await createMailer({ apiKey: "re_test", disabled: true, onResult: sink, logger: () => {} }).send({ to: "c@x.dk", subject: "s", text: "t" });
    expect(seen).toStrictEqual([
      { to: "stranger@x.dk", outcome: "skipped", reason: "not-live" },
      { to: "b@x.dk", outcome: "skipped", reason: "no-key" },
      { to: "c@x.dk", outcome: "skipped", reason: "disabled" },
    ]);
  });

  it("a FAILURE carries the provider's reason", async () => {
    const seen: MailOutcomeEntry[] = [];
    const fail = vi.fn(async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 }));
    await live((e) => seen.push(e), fail).send({ to: "a@x.dk", subject: "s", text: "t" });
    expect(seen).toStrictEqual([{ to: "a@x.dk", outcome: "failed", reason: "domain not verified" }]);
  });

  it("`reason` is REQUIRED on skipped and failed — enforced by the type", () => {
    // @ts-expect-error a skip without a reason is not constructible
    const bad: MailOutcomeEntry = { to: "a@x.dk", outcome: "skipped" };
    // @ts-expect-error a failure without a reason is not constructible
    const bad2: MailOutcomeEntry = { to: "a@x.dk", outcome: "failed" };
    const good: MailOutcomeEntry = { to: "a@x.dk", outcome: "sent" };
    expect([bad, bad2, good].length).toBe(3);
  });

  it("xrt81's real shape: 14 recipients in one send loop → 14 receipts, each its own recipient", async () => {
    const seen: MailOutcomeEntry[] = [];
    const mailer = live((e) => seen.push(e));
    const recipients = Array.from({ length: 14 }, (_, i) => `member${i + 1}@x.dk`);
    for (const to of recipients) await mailer.send({ to, subject: "s", text: "t" });
    expect(seen.map((e) => e.to)).toStrictEqual(recipients);
    expect(seen.every((e) => e.outcome === "sent")).toBe(true);
  });

  it("one send to N addresses → N receipts", async () => {
    const seen: MailOutcomeEntry[] = [];
    await live((e) => seen.push(e)).send({ to: ["a@x.dk", "b@x.dk", "c@x.dk"], subject: "s", text: "t" });
    expect(seen.map((e) => e.to)).toStrictEqual(["a@x.dk", "b@x.dk", "c@x.dk"]);
  });

  it("a sink that THROWS does not fail the send", async () => {
    const r = await live(() => { throw new Error("log store down"); }).send({ to: "a@x.dk", subject: "s", text: "t" });
    expect(r).toMatchObject({ ok: true, id: "re_1" });
  });

  it("a sink that REJECTS does not fail the send (no unhandled rejection)", async () => {
    const r = await live(async () => { throw new Error("async store down"); }).send({ to: "a@x.dk", subject: "s", text: "t" });
    expect(r).toMatchObject({ ok: true, id: "re_1" });
  });

  it("a sink that HANGS does not delay the send", async () => {
    const t0 = Date.now();
    const r = await live(() => new Promise<void>(() => {})).send({ to: "a@x.dk", subject: "s", text: "t" });
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("send()'s return shape is unchanged — no receipt fields leak into it", async () => {
    const r = await live(() => {}).send({ to: "a@x.dk", subject: "s", text: "t" });
    expect(Object.keys(r).sort()).toStrictEqual(["id", "integrity", "ok"]);
  });

  it("tenant is never sent to the provider", async () => {
    const f = ok();
    await live(() => {}, f).send({ to: "a@x.dk", subject: "s", text: "t", tenant: "t1" });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).not.toHaveProperty("tenant");
  });
});

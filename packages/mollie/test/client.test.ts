import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { computeSplit, createMollieClient, createClassicWebhookHandler, fromMollieAmount, toMollieAmount, verifyMollieSignature } from "../src/index";
import { fakeMollie } from "./fake-mollie";

function rig() {
  const fm = fakeMollie();
  const r = createMollieClient({ apiKey: "test_abc", fetch: fm.fetch });
  if (!r.enabled) throw new Error("expected enabled");
  return { fm, mollie: r.mollie, testMode: r.testMode };
}
const SPLIT = { rules: [{ recipient: "platform", fixed: 2_500 }, { recipient: "platform", percent: 30 }, { recipient: "dev", percent: 60 }, { recipient: "clinic", percent: 10 }], remainderTo: "platform" };
const ORGS = { dev: { organizationId: "org_dev" }, clinic: { organizationId: "org_clinic" } };

describe("client basics", () => {
  it("ship dark: no key → disabled, never a throw", () => {
    expect(createMollieClient({ apiKey: "" })).toEqual({ enabled: false, testMode: false, mollie: null });
  });
  it("test mode follows the key prefix", () => expect(rig().testMode).toBe(true));
  it("amounts: øre ↔ Mollie's string value, exact", () => {
    expect(toMollieAmount(19_900, "dkk")).toEqual({ currency: "DKK", value: "199.00" });
    expect(toMollieAmount(5, "EUR")).toEqual({ currency: "EUR", value: "0.05" });
    expect(fromMollieAmount({ currency: "DKK", value: "174.40" })).toBe(17_440);
    expect(fromMollieAmount({ currency: "DKK", value: "3" })).toBe(300);
    expect(() => toMollieAmount(1.5, "DKK")).toThrow(/whole minor units/);
  });
});

describe("customer, mandate and monthly charges", () => {
  it("first payment carries sequenceType first + customerId and returns the checkout url; recurring carries the mandate", async () => {
    const { fm, mollie } = rig();
    const c = await mollie.createCustomer({ name: "Klinik Nord", email: "k@example.dk" });
    const first = await mollie.createFirstPayment({ customerId: c.id, amount: 19_900, currency: "DKK", description: "fysio.work — november", redirectUrl: "https://fysio.work/ok", webhookUrl: "https://fysio.work/api/mollie" });
    expect(first.checkoutUrl).toMatch(/^https:\/\/pay\.mollie\.test\//);
    const sent = fm.requests.find((r) => r.path === "/payments")!;
    expect(sent.body).toMatchObject({ amount: { currency: "DKK", value: "199.00" }, sequenceType: "first", customerId: c.id });
    expect(sent.auth).toBe("Bearer test_abc");
    const rec = await mollie.createRecurringPayment({ customerId: c.id, mandateId: "mdt_1", amount: 19_900, currency: "DKK", description: "fysio.work — december" });
    expect(fm.payments.get(rec.id)).toMatchObject({ sequenceType: "recurring", customerId: c.id, mandateId: "mdt_1" });
  });
  it("a Mollie error surfaces with its status", async () => {
    const fm = fakeMollie();
    const r = createMollieClient({ apiKey: "live_wrong", fetch: fm.fetch });
    if (!r.enabled) throw new Error();
    await expect(r.mollie.getPayment("tr_1")).rejects.toMatchObject({ status: 401 });
  });
});

describe("routePayment — the three-way split executed", () => {
  it("routes developer and clinic shares; the platform's share stays (no route to itself)", async () => {
    const { fm, mollie } = rig();
    const p = await mollie.createRecurringPayment({ customerId: "cst_x", amount: 19_900, currency: "DKK", description: "m" });
    fm.markPaid(p.id);
    const r = await mollie.routePayment({ paymentId: p.id, lines: computeSplit(19_900, SPLIT), platform: "platform", recipients: ORGS });
    expect(r.created.map((x) => [x.destination.organizationId, x.amount.value])).toEqual([["org_dev", "104.40"], ["org_clinic", "17.40"]]);
  });
  it("idempotent: a second call creates nothing", async () => {
    const { fm, mollie } = rig();
    const p = await mollie.createRecurringPayment({ customerId: "cst_x", amount: 19_900, currency: "DKK", description: "m" });
    fm.markPaid(p.id);
    const args = { paymentId: p.id, lines: computeSplit(19_900, SPLIT), platform: "platform", recipients: ORGS };
    await mollie.routePayment(args);
    const again = await mollie.routePayment(args);
    expect(again.created).toEqual([]);
    expect(fm.routes.get(p.id)).toHaveLength(2);
  });
  it("refuses: unpaid payment, lines that do not sum to the payment, a missing organization, a changed amount", async () => {
    const { fm, mollie } = rig();
    const p = await mollie.createRecurringPayment({ customerId: "cst_x", amount: 19_900, currency: "DKK", description: "m" });
    const lines = computeSplit(19_900, SPLIT);
    await expect(mollie.routePayment({ paymentId: p.id, lines, platform: "platform", recipients: ORGS })).rejects.toMatchObject({ status: 409 });
    fm.markPaid(p.id);
    await expect(mollie.routePayment({ paymentId: p.id, lines: computeSplit(10_000, SPLIT), platform: "platform", recipients: ORGS })).rejects.toThrow(/sum to 10000, but the payment is 19900/);
    await expect(mollie.routePayment({ paymentId: p.id, lines, platform: "platform", recipients: { dev: ORGS.dev } })).rejects.toThrow(/no Mollie organization for recipient "clinic"/);
    expect(fm.routes.get(p.id) ?? []).toHaveLength(1); // dev was routed before clinic failed — a retry completes it (idempotent)
    fm.routes.get(p.id)![0]!.amount.value = "1.00";
    await expect(mollie.routePayment({ paymentId: p.id, lines, platform: "platform", recipients: ORGS })).rejects.toThrow(/refusing to pay twice/);
  });
});

describe("routePayment never double-pays on an unexpected Mollie answer", () => {
  it("a routes response without the list is refused, not read as 'none yet'", async () => {
    const { fm, mollie } = rig();
    const p = await mollie.createRecurringPayment({ customerId: "c", amount: 19_900, currency: "DKK", description: "m" });
    fm.markPaid(p.id);
    const shapeless = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/routes") && (init?.method ?? "GET") === "GET" ? new Response("{}", { status: 200 }) : fm.fetch(input, init)) as typeof fetch;
    const r = createMollieClient({ apiKey: "test_abc", fetch: shapeless });
    if (!r.enabled) throw new Error();
    await expect(r.mollie.routePayment({ paymentId: p.id, lines: computeSplit(19_900, SPLIT), platform: "platform", recipients: ORGS })).rejects.toThrow(/refusing to assume none exist/);
    expect(fm.routes.get(p.id) ?? []).toHaveLength(0);
  });
});

describe("refunds", () => {
  it("full refund reverses routing; partial names each reversal", async () => {
    const { fm, mollie } = rig();
    await mollie.refundPayment({ paymentId: "tr_9", amount: 19_900, currency: "DKK", reverseRouting: true });
    await mollie.refundPayment({ paymentId: "tr_9", amount: 5_000, currency: "DKK", routingReversals: [{ organizationId: "org_dev", amount: 3_500 }] });
    expect(fm.refunds[0]).toMatchObject({ reverseRouting: true, amount: { value: "199.00" } });
    expect(fm.refunds[1]).toMatchObject({ routingReversals: [{ amount: { currency: "DKK", value: "35.00" }, source: { type: "organization", organizationId: "org_dev" } }] });
    await expect(mollie.refundPayment({ paymentId: "tr_9", amount: 1, currency: "DKK", reverseRouting: true, routingReversals: [] })).rejects.toThrow(/not both/);
  });
});

describe("webhooks", () => {
  const post = (body: string) => new Request("https://fysio.work/api/mollie", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  it("classic: the handler only ever sees the payment FETCHED from Mollie", async () => {
    const { fm, mollie } = rig();
    const p = await mollie.createRecurringPayment({ customerId: "c", amount: 100, currency: "DKK", description: "x" });
    fm.markPaid(p.id);
    const seen: string[] = [];
    const h = createClassicWebhookHandler({ mollie, onPayment: (pay) => { seen.push(`${pay.id}:${pay.status}`); } });
    expect((await h(post(`id=${p.id}`))).status).toBe(200);
    expect(seen).toEqual([`${p.id}:paid`]);
  });
  it("classic: a forged/unknown id is acknowledged but never reaches the handler; garbage is 400; a throwing handler is 500 (Mollie retries)", async () => {
    const { mollie } = rig();
    let called = 0;
    const h = createClassicWebhookHandler({ mollie, onPayment: () => { called++; } });
    expect((await h(post("id=tr_doesnotexist"))).status).toBe(200);
    expect((await h(post("id=<script>"))).status).toBe(400);
    expect(called).toBe(0);
    const { fm, mollie: m2 } = rig();
    const p = await m2.createRecurringPayment({ customerId: "c", amount: 100, currency: "DKK", description: "x" });
    const bad = createClassicWebhookHandler({ mollie: m2, onPayment: () => { throw new Error("db down"); } });
    expect((await bad(post(`id=${p.id}`))).status).toBe(500);
    void fm;
  });
  it("next-gen: HMAC signature verified; wrong secret, tampered body and malformed header refused", () => {
    const body = '{"resource":"event","id":"event_1"}';
    const sig = "sha256=" + createHmac("sha256", "whsec_test").update(body).digest("hex");
    expect(verifyMollieSignature(body, sig, "whsec_test")).toBe(true);
    expect(verifyMollieSignature(body, sig, "whsec_other")).toBe(false);
    expect(verifyMollieSignature(body + " ", sig, "whsec_test")).toBe(false);
    expect(verifyMollieSignature(body, "sha256=zz", "whsec_test")).toBe(false);
    expect(verifyMollieSignature(body, null, "whsec_test")).toBe(false);
  });
});

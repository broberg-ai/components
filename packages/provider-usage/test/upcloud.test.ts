/**
 * F113.1 — UpCloud, against the response shapes in UpCloud's own documentation
 * (developers.upcloud.com/1.3/3-accounts, copied 7 Nov 2026). A fake agrees with what this file
 * believes the API is; the live half waits for a key with billing rights.
 */
import { describe, expect, test } from "vitest";
import { createUpcloudUsage } from "../src/index.js";

const TOKEN = "ucat_TEST-TOKEN-SHOULD-NEVER-APPEAR-7f1";

// Verbatim from the docs: GET /1.3/account/billing/summary/2024-09
const SUMMARY = {
  currency: "EUR",
  managed_databases: { managed_database: { resources: [{ amount: 15.10223, details: [{ amount: 15.10223, hours: 420, plan: "1x1xCPU-2GB-25GB", zone: "fi-hel2" }], hours: 420, resource_id: "09001a4d-b525-4ab8-835d-000000000000" }], total_amount: 15.10223 }, total_amount: 15.10223 },
  managed_object_storages: { managed_object_storage: { resources: [{ amount: 5.03384, details: [{ amount: 5.03384, billable_size_gib: 500, hours: 420, zone: "fi-hel2" }], hours: 420, resource_id: "127ee42a-8304-477c-84e1-000000000000" }], total_amount: 5.03384 }, total_amount: 5.03384 },
  servers: { server: { resources: [
    { amount: 16.18091, details: [{ amount: 16.18091, hours: 420, labels: [{ key: "test", value: "" }], plan: "2xCPU-4GB", zone: "fi-hel2" }], hours: 420, resource_id: "001c2caa-00dc-4eff-9321-000000000000" },
    { amount: 16.10386, details: [{ amount: 16.10386, hours: 418, labels: [{ key: "test2", value: "" }], plan: "2xCPU-4GB", zone: "fi-hel2" }, { amount: 0.9288, hours: 12, labels: [{ key: "test2", value: "" }], plan: "4xCPU-8GB", zone: "fi-hel2" }], hours: 430, resource_id: "0010cf04-3608-4512-b4de-000000000000" },
  ], total_amount: 33.21357 }, total_amount: 33.21357 },
  total_amount: 53.34964,
};
// Verbatim shape: GET /1.3/account/resource_billing_summary/{id}/2019-12
const DAILY = { billing: { daily_sums: { "2024-09-03": 1.5, "2024-09-02": 3.33684 }, details: { hours: 420, plan: "1x1xCPU-2GB-25GB", resource_id: "x", title: "db", type: "managed_database", zone: "fi-hel2" }, total_amount: 4.83684 } };

type Reply = { status: number; body?: unknown } | Error;
function api(route: (path: string) => Reply) {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    calls.push({ url: String(url), method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization") });
    // Every call this package may make. Anything else is a test failure, /database first.
    if (!/^\/1\.3\/account\/(billing\/summary|resource_billing_summary\/[^/]+)\/\d{4}-\d{2}$/.test(u.pathname)) throw new Error(`test: forbidden call ${init?.method} ${u.pathname}`);
    const r = route(u.pathname);
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const NOW = () => new Date("2024-09-20T10:00:00Z");
const usage = (impl: typeof fetch, token: string | undefined = TOKEN) => createUpcloudUsage({ token, fetch: impl, now: NOW });

describe("F113.1 — UpCloud billed cost per resource", () => {
  test("every resource in the summary becomes one billed line; only ONE GET to the billing path, with the Bearer key", async () => {
    const { impl, calls } = api(() => ({ status: 200, body: SUMMARY }));
    const r = await usage(impl).month("2024-09");
    expect(calls).toStrictEqual([{ url: "https://api.upcloud.com/1.3/account/billing/summary/2024-09", method: "GET", auth: `Bearer ${TOKEN}` }]);
    if (!r.ok) throw new Error(r.message);
    expect(r.total).toStrictEqual({ amount: 53.34964, currency: "EUR" });
    expect(r.lines.map((l) => [l.resourceType, l.resourceId, l.amount])).toStrictEqual([
      ["managed_database", "09001a4d-b525-4ab8-835d-000000000000", 15.10223],
      ["managed_object_storage", "127ee42a-8304-477c-84e1-000000000000", 5.03384],
      ["server", "001c2caa-00dc-4eff-9321-000000000000", 16.18091],
      ["server", "0010cf04-3608-4512-b4de-000000000000", 16.10386],
    ]);
    expect(r.lines[0]).toStrictEqual({
      provider: "upcloud", resourceId: "09001a4d-b525-4ab8-835d-000000000000", resourceType: "managed_database",
      period: { from: "2024-09-01", to: "2024-10-01" }, amount: 15.10223, currency: "EUR", basis: "billed", complete: false,
      details: { segments: [{ amount: 15.10223, hours: 420, plan: "1x1xCPU-2GB-25GB", zone: "fi-hel2" }], hours: 420, plan: "1x1xCPU-2GB-25GB", zone: "fi-hel2" },
      fetchedAt: "2024-09-20T10:00:00.000Z",
    });
    expect(r.lines.every((l) => l.basis === "billed")).toBe(true);
  });

  test("a mid-month resize: two segments, and NO single plan claimed for the month", async () => {
    const { impl } = api(() => ({ status: 200, body: SUMMARY }));
    const r = await usage(impl).month("2024-09");
    if (!r.ok) throw new Error(r.message);
    const resized = r.lines[3]!;
    expect(resized.details.segments.map((s) => s.plan)).toStrictEqual(["2xCPU-4GB", "4xCPU-8GB"]);
    expect(resized.details.plan).toBeUndefined();
    expect(resized.details.zone).toBe("fi-hel2");
  });

  test("a closed month is complete; the running month is not; December rolls the year", async () => {
    const { impl } = api(() => ({ status: 200, body: SUMMARY }));
    const past = await usage(impl).month("2023-12");
    if (!past.ok) throw new Error(past.message);
    expect(past.lines[0]!.complete).toBe(true);
    expect(past.lines[0]!.period).toStrictEqual({ from: "2023-12-01", to: "2024-01-01" });
  });

  test("daily: one extra GET per resource to resource_billing_summary, sorted by date", async () => {
    const one = { currency: "EUR", managed_databases: { managed_database: { resources: [SUMMARY.managed_databases.managed_database.resources[0]], total_amount: 15.10223 }, total_amount: 15.10223 }, total_amount: 15.10223 };
    const { impl, calls } = api((p) => ({ status: 200, body: p.includes("resource_billing_summary") ? DAILY : one }));
    const r = await usage(impl).month("2024-09", { daily: true });
    if (!r.ok) throw new Error(r.message);
    expect(calls.map((c) => [c.method, new URL(c.url).pathname])).toStrictEqual([
      ["GET", "/1.3/account/billing/summary/2024-09"],
      ["GET", "/1.3/account/resource_billing_summary/09001a4d-b525-4ab8-835d-000000000000/2024-09"],
    ]);
    expect(r.lines[0]!.details.daily).toStrictEqual([{ date: "2024-09-02", amount: 3.33684 }, { date: "2024-09-03", amount: 1.5 }]);
  });

  for (const status of [403, 404]) {
    test(`HTTP ${status} on billing (a key without billing rights) → no_billing_access, NEVER an empty list`, async () => {
      const { impl } = api(() => ({ status, body: { error: { error_code: "FORBIDDEN" } } }));
      const r = await usage(impl).month("2024-09");
      expect(r).toStrictEqual({ ok: false, provider: "upcloud", reason: "no_billing_access", status, message: `this UpCloud key may not read billing (HTTP ${status}) — it needs «read billing details»` });
    });
  }

  for (const status of [401, 429, 500, 503]) {
    test(`HTTP ${status} → unavailable with the status`, async () => {
      const { impl } = api(() => ({ status }));
      const r = await usage(impl).month("2024-09");
      expect(r).toMatchObject({ ok: false, reason: "unavailable", status });
    });
  }

  test("network failure → unavailable; the token is in no failure message", async () => {
    const { impl } = api(() => new TypeError(`fetch failed ${TOKEN}`));
    const r = await usage(impl).month("2024-09");
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  test("no key → not_configured and NOTHING is called", async () => {
    const { impl, calls } = api(() => ({ status: 200, body: SUMMARY }));
    expect(await usage(impl, "").month("2024-09")).toStrictEqual({ ok: false, provider: "upcloud", reason: "not_configured", message: "no UpCloud billing key configured" });
    expect(await createUpcloudUsage({ fetch: impl, now: NOW }).month("2024-09")).toMatchObject({ reason: "not_configured" });
    expect(calls.length).toBe(0);
  });

  test("an amount that is not a number is invalid_response — never read as 0", async () => {
    const bad = structuredClone(SUMMARY) as typeof SUMMARY & { servers: { server: { resources: { amount: unknown }[] } } };
    (bad.servers.server.resources[0] as { amount: unknown }).amount = "16.18";
    const { impl } = api(() => ({ status: 200, body: bad }));
    expect(await usage(impl).month("2024-09")).toMatchObject({ ok: false, reason: "invalid_response" });
  });

  test("no currency, or not JSON → invalid_response", async () => {
    const { impl: a } = api(() => ({ status: 200, body: { ...SUMMARY, currency: undefined } }));
    expect(await usage(a).month("2024-09")).toMatchObject({ reason: "invalid_response" });
    const { impl: b } = api(() => ({ status: 200, body: "<html>" }));
    expect(await usage(b).month("2024-09")).toMatchObject({ reason: "invalid_response" });
  });

  test("a month that is not YYYY-MM throws before any request", async () => {
    const { impl, calls } = api(() => ({ status: 200, body: SUMMARY }));
    await expect(usage(impl).month("2024-9")).rejects.toThrow(/YYYY-MM/);
    await expect(usage(impl).month("../database")).rejects.toThrow(/YYYY-MM/);
    expect(calls.length).toBe(0);
  });

  test("THE ALLOWLIST IS IN THE CODE: a resource id that would leave the billing path is refused before a request", async () => {
    const evil = { currency: "EUR", servers: { server: { resources: [{ amount: 1, details: [], hours: 1, resource_id: "../../database" }], total_amount: 1 }, total_amount: 1 }, total_amount: 1 };
    const { impl, calls } = api((p) => ({ status: 200, body: p.includes("resource_billing") ? DAILY : evil }));
    await expect(usage(impl).month("2024-09", { daily: true })).rejects.toThrow(/refusing to call/);
    expect(calls.map((c) => new URL(c.url).pathname)).toStrictEqual(["/1.3/account/billing/summary/2024-09"]);
  });
});

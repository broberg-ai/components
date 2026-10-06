// F097.2 — the server half AnalyticsPage relies on is Upmetrics' own
// (`@upmetrics/sdk/hono` analyticsRoutes, built for us in upmetrics-F045). This
// pins its CONTRACT, so a release that changes a status or a field turns this
// red here instead of turning the page wrong in every app. Upstream is a stubbed
// fetch, so nothing leaves the machine.
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { analyticsRoutes } from "@upmetrics/sdk/hono";
import { analyticsErrorKind, createFetchAnalyticsAdapter, type AnalyticsData } from "../src/index";

const KEY = "uk_TEST-SECRET-0123456789";
const DATA: AnalyticsData = {
  totals: { visitors: 3, pageviews: 9 },
  prev: { visitors: 1, pageviews: 2 },
  series: [{ day: "2026-10-06", visitors: 3, pageviews: 9 }],
  topPages: [{ value: "/", count: 9 }],
};

function mount(opts: { projectKey?: string; upstream?: (url: string, init?: RequestInit) => Response | Promise<Response> }) {
  const seen: { url: string; auth: string | null }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, auth: new Headers(init?.headers).get("authorization") ?? new Headers(init?.headers).get("x-upmetrics-key") });
    return opts.upstream ? opts.upstream(url, init) : Response.json(DATA);
  });
  const app = new Hono();
  app.route("/", analyticsRoutes({ ...(opts.projectKey ? { projectKey: opts.projectKey } : {}), fetch: fetch as unknown as typeof globalThis.fetch }));
  const get = (q = "") => app.request(`https://app.example/api/analytics${q}`);
  return { get, seen, fetch };
}

describe("@upmetrics/sdk/hono analyticsRoutes — the contract AnalyticsPage reads", () => {
  it("200 with the AnalyticsResponse, which AnalyticsPage's own adapter accepts as is", async () => {
    const m = mount({ projectKey: KEY });
    const r = await m.get("?days=30");
    expect([r.status, r.headers.get("cache-control")]).toEqual([200, "no-store"]);
    const viaAdapter = await createFetchAnalyticsAdapter({ fetch: (async () => r) as unknown as typeof fetch }).load(30);
    expect(viaAdapter).toEqual(DATA);
  });

  it("no key → 503 analytics_unconfigured, no-store, nothing sent upstream — and the page calls it «unconfigured»", async () => {
    const prev = process.env.UPMETRICS_API_KEY;
    delete process.env.UPMETRICS_API_KEY;
    try {
      const m = mount({});
      const r = await m.get();
      const body = await r.json();
      expect([r.status, body, r.headers.get("cache-control"), m.fetch.mock.calls.length]).toEqual([503, { error: "analytics_unconfigured" }, "no-store", 0]);
      expect(analyticsErrorKind(await createFetchAnalyticsAdapter({ fetch: (async () => Response.json(body, { status: 503 })) as unknown as typeof fetch }).load(7).catch((e) => e))).toBe("unconfigured");
    } finally {
      if (prev !== undefined) process.env.UPMETRICS_API_KEY = prev;
    }
  });

  it("upstream fails → 502 analytics_unavailable, no-store, and the key is in no body and no log line", async () => {
    const logs: string[] = [];
    const spies = (["log", "warn", "error", "info"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))));
    try {
      const m = mount({ projectKey: KEY, upstream: () => new Response(`echo ${KEY}`, { status: 500 }) });
      const r = await m.get("?days=7");
      const text = await r.text();
      expect([r.status, JSON.parse(text), r.headers.get("cache-control")]).toEqual([502, { error: "analytics_unavailable" }, "no-store"]);
      expect(text.includes(KEY)).toBe(false);
      expect(logs.some((l) => l.includes(KEY))).toBe(false);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it("days is clamped to 1..365 before it goes upstream; a non-number is not forwarded", async () => {
    const m = mount({ projectKey: KEY });
    for (const q of ["?days=999", "?days=0", "?days=7", "?days=abc"]) await m.get(q);
    const days = m.seen.map((s) => new URL(s.url).searchParams.get("days"));
    expect(days).toEqual(["365", "1", "7", null]);
  });
});

// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F097.1 — AnalyticsPage: the app's own visitor numbers from Upmetrics.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AnalyticsError,
  AnalyticsPage,
  analyticsErrorKind,
  changePct,
  copenhagenDay,
  createFetchAnalyticsAdapter,
  fillDays,
  type AnalyticsAdapter,
  type AnalyticsData,
} from "../src/preact";

afterEach(cleanup);

const DATA: AnalyticsData = {
  totals: { visitors: 1234, pageviews: 5678 },
  prev: { visitors: 1000, pageviews: 0 },
  series: [{ day: copenhagenDay(), visitors: 3, pageviews: 9 }],
  topPages: [
    { value: "/", count: 40 },
    { value: "/en/meget/lang/sti/der/aldrig/maa/skubbe/siden/sidelaens/paa/en/telefon", count: 2 },
  ],
};

function fakeAdapter(load: AnalyticsAdapter["load"] = async () => structuredClone(DATA)) {
  return { load: vi.fn(load) };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fillDays — the whole period on the Copenhagen calendar", () => {
  it("returns exactly `days` entries ending today, keeps Upmetrics' values, zero elsewhere", () => {
    const now = new Date("2026-10-06T10:00:00Z");
    const out = fillDays([{ day: "2026-10-04", visitors: 2, pageviews: 7 }], 7, now);
    expect(out.map((d) => d.day)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
    expect(out.map((d) => d.pageviews)).toEqual([0, 0, 0, 0, 7, 0, 0]);
  });
  it("crosses a month boundary", () => {
    const out = fillDays([], 3, new Date("2026-03-01T10:00:00Z"));
    expect(out.map((d) => d.day)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
  it("at 23:30Z it is already TOMORROW in Copenhagen — the last day is the Danish date, not the UTC one", () => {
    expect(fillDays([], 1, new Date("2026-10-05T23:30:00Z")).map((d) => d.day)).toEqual(["2026-10-06"]);
    // negative control: 21:30Z is 23:30 the 5th in Copenhagen (summer time), so still the 5th.
    expect(fillDays([], 1, new Date("2026-10-05T21:30:00Z")).map((d) => d.day)).toEqual(["2026-10-05"]);
  });
  it("a DST change neither skips nor repeats a day", () => {
    const out = fillDays([], 4, new Date("2026-10-26T12:00:00Z")); // DST ended 25/10
    expect(out.map((d) => d.day)).toEqual(["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]);
  });
});

describe("changePct", () => {
  it("rounds, signs, and has no comparison against zero", () => {
    expect([changePct(1234, 1000), changePct(50, 100), changePct(5, 0), changePct(0, 0)]).toEqual([23, -50, null, null]);
  });
});

describe("AnalyticsPage", () => {
  it("shows both totals with the change against the previous period, and «Ingen sammenligning» when it was 0", async () => {
    render(<AnalyticsPage lang="da" adapter={fakeAdapter()} />);
    expect((await screen.findByTestId("analytics-visitors-value")).textContent).toBe((1234).toLocaleString("da-DK"));
    expect(screen.getByTestId("analytics-visitors-change").textContent).toBe("+23 % mod forrige periode");
    expect(screen.getByTestId("analytics-pageviews-value").textContent).toBe((5678).toLocaleString("da-DK"));
    expect(screen.getByTestId("analytics-pageviews-change").textContent).toBe("Ingen sammenligning");
  });

  it("starts on 30 days, the toggle is aria-pressed, and a click loads that period", async () => {
    const a = fakeAdapter();
    render(<AnalyticsPage lang="da" adapter={a} />);
    await screen.findByTestId("analytics-visitors-value");
    expect(a.load.mock.calls).toEqual([[30]]);
    expect(["7", "30", "90"].map((d) => screen.getByTestId(`analytics-period-${d}`).getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    fireEvent.click(screen.getByTestId("analytics-period-7"));
    await waitFor(() => expect(a.load.mock.calls).toEqual([[30], [7]]));
    expect(screen.getByTestId("analytics-period-7").getAttribute("aria-pressed")).toBe("true");
  });

  it("draws exactly `days` bars, with the screen-reader table carrying the same numbers", async () => {
    render(<AnalyticsPage lang="da" adapter={fakeAdapter()} periods={[7]} />);
    const series = await screen.findByTestId("analytics-series");
    expect(series.querySelectorAll(".bas-analytics__col").length).toBe(7);
    const rows = [...screen.getByTestId("analytics-series-table").querySelectorAll("tbody tr")].map((r) => r.lastElementChild!.textContent);
    expect(rows).toEqual(["0", "0", "0", "0", "0", "0", "9"]);
  });

  it("a late answer for a period the user already left is dropped", async () => {
    let slow!: (d: AnalyticsData) => void;
    const a = fakeAdapter((days) => (days === 30 ? new Promise((r) => (slow = r)) : Promise.resolve({ ...structuredClone(DATA), totals: { visitors: 7, pageviews: 7 } })));
    render(<AnalyticsPage lang="da" adapter={a} />);
    fireEvent.click(screen.getByTestId("analytics-period-7"));
    expect((await screen.findByTestId("analytics-visitors-value")).textContent).toBe("7");
    slow(structuredClone(DATA));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId("analytics-visitors-value").textContent).toBe("7");
  });

  it("no visits → the empty line for the chart and the pages, not a flat chart", async () => {
    render(<AnalyticsPage lang="en" adapter={fakeAdapter(async () => ({ ...structuredClone(DATA), series: [], topPages: [] }))} />);
    expect((await screen.findByTestId("analytics-series-empty")).textContent).toBe("No visits in this period.");
    expect(screen.getByTestId("analytics-top-pages-empty").textContent).toBe("No visits in this period.");
  });

  it.each([
    ["503 analytics_unconfigured", json({ error: "analytics_unconfigured" }, 503), "Analytics er ikke sat op for denne app."],
    ["502 analytics_unavailable", json({ error: "analytics_unavailable" }, 502), "Upmetrics svarer ikke lige nu. Prøv igen om lidt."],
    ["503 without that code", json({ error: "other" }, 503), "Upmetrics svarer ikke lige nu. Prøv igen om lidt."],
  ])("%s through the DEFAULT fetch adapter → the named message, and no numbers anywhere", async (_l, res, msg) => {
    vi.stubGlobal("fetch", vi.fn(async () => res));
    try {
      render(<AnalyticsPage lang="da" />);
      expect((await screen.findByTestId("analytics-error")).textContent).toBe(msg);
      expect(screen.queryByTestId("analytics-visitors-value")).toBeNull();
      expect(screen.queryByTestId("analytics-series")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("every interactive element carries a data-testid", async () => {
    render(<AnalyticsPage lang="da" adapter={fakeAdapter()} />);
    await screen.findByTestId("analytics-visitors-value");
    const missing = [...screen.getByTestId("analytics-page").querySelectorAll("button, input, a, select, textarea")].filter((el) => !el.getAttribute("data-testid"));
    expect(missing.map((el) => el.outerHTML)).toEqual([]);
  });
});

describe("createFetchAnalyticsAdapter", () => {
  it("GET /api/analytics?days=N, same-origin", async () => {
    const f = vi.fn(async () => json(DATA));
    await createFetchAnalyticsAdapter({ fetch: f as unknown as typeof fetch }).load(90);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.credentials]).toEqual(["/api/analytics?days=90", "same-origin"]);
  });
  it("a 200 that is not analytics, and a network failure, both THROW — never zeros", async () => {
    await expect(createFetchAnalyticsAdapter({ fetch: (async () => json({ ok: true })) as unknown as typeof fetch }).load(7)).rejects.toMatchObject({ code: "bad_response" });
    await expect(createFetchAnalyticsAdapter({ fetch: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch }).load(7)).rejects.toMatchObject({ status: 0 });
  });
  it("analyticsErrorKind: only the explicit 503 code is «unconfigured»", () => {
    expect([analyticsErrorKind(new AnalyticsError(503, "analytics_unconfigured")), analyticsErrorKind(new AnalyticsError(0)), analyticsErrorKind(new Error("x"))]).toEqual(["unconfigured", "unavailable", "unavailable"]);
  });
});

describe("AnalyticsPage — layout guard (393 px)", () => {
  it("long paths truncate inside their row, bars may shrink, toggle labels never wrap", () => {
    const css = readFileSync(join(__dirname, "../css/app-shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((x) => x.trim()).includes(sel)).map((m) => m[2]).join(";");
    expect(rule(".bas-analytics__path")).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule(".bas-analytics__path")).toMatch(/min-width:\s*0/);
    expect(rule(".bas-analytics__col")).toMatch(/min-width:\s*0/);
    expect(rule(".bas-analytics__period")).toMatch(/white-space:\s*nowrap/);
    expect(rule(".bas-analytics")).not.toMatch(/(^|;)\s*width:\s*\d+px/);
  });
});

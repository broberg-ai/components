import { describe, it, expect, vi, afterEach } from "vitest";
import { createClient } from "@libsql/client";
import { deriveDevice } from "../src/index";
import { createSqlDeviceStore, summarize, type SqlExecutor, type DeviceRow } from "../src/store";
import { handleDeviceBeacon, sendLaunchBeacon, MAX_DEVICE_BEACON_CHARS } from "../src/beacon";

// A real iPhone Safari UA (same family as fixtures.ts) — the beacon must derive
// from the request's OWN headers, so a real string is the honest input.
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function freshDb() {
  return createClient({ url: ":memory:" });
}

describe("createSqlDeviceStore — against a REAL SQLite database", () => {
  it("migrate is idempotent, and two increments ADD (negative control: an overwrite would read 1)", async () => {
    const db = freshDb();
    const store = createSqlDeviceStore(db, { dialect: "sqlite" });
    await store.migrate();
    await store.migrate();
    const facts = deriveDevice({ headers: { "user-agent": IPHONE_UA }, launchCtx: "pwa" });
    await store.increment(facts, "2026-10-25");
    await store.increment(facts, "2026-10-25");
    const rows = await store.read();
    expect(rows).toEqual([
      { day: "2026-10-25", formFactor: "mobile", os: "iOS", browser: "Safari", launch: "installed", count: 2 },
    ]);
  });

  it("different facts are different rows; `by` adds that many", async () => {
    const store = createSqlDeviceStore(freshDb(), { dialect: "sqlite" });
    await store.migrate();
    await store.increment(deriveDevice({ headers: { "user-agent": IPHONE_UA } }), "2026-10-25", 3);
    await store.increment(deriveDevice({ headers: { "user-agent": IPHONE_UA }, launchCtx: "pwa" }), "2026-10-25");
    const rows = await store.read();
    expect(rows.map((r) => [r.launch, r.count])).toEqual([
      ["browser", 3],
      ["installed", 1],
    ]);
  });

  it("read filters by since/until, inclusive", async () => {
    const store = createSqlDeviceStore(freshDb(), { dialect: "sqlite" });
    await store.migrate();
    const f = deriveDevice({ headers: { "user-agent": IPHONE_UA } });
    for (const d of ["2026-10-23", "2026-10-24", "2026-10-25"]) await store.increment(f, d);
    expect((await store.read({ since: "2026-10-24" })).map((r) => r.day)).toEqual(["2026-10-24", "2026-10-25"]);
    expect((await store.read({ until: "2026-10-24" })).map((r) => r.day)).toEqual(["2026-10-23", "2026-10-24"]);
  });

  it("D-aaf46c, asserted on the TABLE ITSELF: no column for path, url, user or session", async () => {
    const db = freshDb();
    await createSqlDeviceStore(db, { dialect: "sqlite" }).migrate();
    const { rows } = await db.execute("PRAGMA table_info(device_stats)");
    const cols = Array.from(rows, (r) => String(r.name)).sort();
    expect(cols).toEqual(["browser", "count", "day", "form_factor", "launch", "os"]);
  });

  it("refuses an invalid table name at construction, naming it", () => {
    expect(() => createSqlDeviceStore(freshDb(), { dialect: "sqlite", table: "x; DROP TABLE y" })).toThrow(/x; DROP TABLE y/);
  });

  it("refuses a day that is not YYYY-MM-DD", async () => {
    const store = createSqlDeviceStore(freshDb(), { dialect: "sqlite" });
    await store.migrate();
    await expect(store.increment(deriveDevice({}), "25/10/2026")).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe("the postgres dialect", () => {
  it("uses $n placeholders and BIGINT, and normalises a string count", async () => {
    const seen: Array<{ sql: string; args?: unknown[] }> = [];
    const sql = (i: number) => seen[i]?.sql ?? "";
    const db: SqlExecutor = {
      async execute(stmt) {
        seen.push(stmt);
        return { rows: stmt.sql.startsWith("SELECT") ? [{ day: "2026-10-25", form_factor: "mobile", os: "iOS", browser: "Safari", launch: "browser", count: "7" }] : [] };
      },
    };
    const store = createSqlDeviceStore(db, { dialect: "postgres" });
    await store.migrate();
    await store.increment(deriveDevice({ headers: { "user-agent": IPHONE_UA } }), "2026-10-25");
    const rows = await store.read({ since: "2026-10-01", until: "2026-10-31" });
    expect(sql(0)).toContain("count BIGINT");
    expect(sql(1)).toContain("VALUES ($1, $2, $3, $4, $5, $6)");
    expect(sql(1)).toContain("count = device_stats.count + excluded.count");
    expect(sql(2)).toContain("day >= $1 AND day <= $2");
    expect(sql(1)).not.toContain("?");
    expect(rows[0]?.count).toBe(7);
  });
});

describe("summarize", () => {
  it("totals per dimension across days", () => {
    const rows: DeviceRow[] = [
      { day: "2026-10-24", formFactor: "mobile", os: "iOS", browser: "Safari", launch: "installed", count: 2 },
      { day: "2026-10-25", formFactor: "mobile", os: "iOS", browser: "Safari", launch: "browser", count: 3 },
      { day: "2026-10-25", formFactor: "desktop", os: "macos", browser: "chrome", launch: "browser", count: 5 },
    ];
    expect(summarize(rows)).toEqual({
      total: 10,
      formFactor: { mobile: 5, desktop: 5 },
      os: { iOS: 5, macos: 5 },
      browser: { Safari: 5, chrome: 5 },
      launch: { installed: 2, browser: 8 },
    });
  });
});

describe("handleDeviceBeacon — an API on another origin still sees the page's launch", () => {
  it("counts launch=installed from the body, everything else from the beacon request's own headers", async () => {
    const store = createSqlDeviceStore(freshDb(), { dialect: "sqlite" });
    await store.migrate();
    const status = await handleDeviceBeacon(store, { headers: { "user-agent": IPHONE_UA }, bodyText: '{"launch":"pwa"}' }, "2026-10-25");
    expect(status).toBe(204);
    expect(await store.read()).toEqual([
      { day: "2026-10-25", formFactor: "mobile", os: "iOS", browser: "Safari", launch: "installed", count: 1 },
    ]);
  });

  it("an empty body is an ordinary browser visit", async () => {
    const store = createSqlDeviceStore(freshDb(), { dialect: "sqlite" });
    await store.migrate();
    expect(await handleDeviceBeacon(store, { headers: { "user-agent": IPHONE_UA }, bodyText: "{}" }, "2026-10-25")).toBe(204);
    expect((await store.read())[0]?.launch).toBe("browser");
  });

  it.each([
    ["not JSON", "pwa"],
    ["an array", "[]"],
    ["null", "null"],
    ["an extra key (a path must not ride along)", '{"launch":"pwa","path":"/behandlinger/psych"}'],
    ["a non-token launch", '{"launch":"<script>"}'],
    ["a non-string launch", '{"launch":1}'],
    ["an oversized body", JSON.stringify({ launch: "x".repeat(MAX_DEVICE_BEACON_CHARS) })],
  ])("refuses %s with 400 and counts NOTHING", async (_label, bodyText) => {
    const increment = vi.fn();
    expect(await handleDeviceBeacon({ increment }, { headers: { "user-agent": IPHONE_UA }, bodyText }, "2026-10-25")).toBe(400);
    expect(increment).not.toHaveBeenCalled();
  });
});

describe("sendLaunchBeacon — Tier 0: reads the page's own query string and NO device API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the marker, and touches navigator/screen/matchMedia ZERO times", async () => {
    const touched: string[] = [];
    const trap = (name: string) =>
      new Proxy({}, { get: (_t, k) => { touched.push(`${name}.${String(k)}`); return undefined; } });
    vi.stubGlobal("navigator", trap("navigator"));
    vi.stubGlobal("screen", trap("screen"));
    vi.stubGlobal("matchMedia", () => { touched.push("matchMedia()"); return {}; });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));

    const ok = await sendLaunchBeacon("https://api.example.dk/device", { search: "?src=pwa&x=1", fetchImpl });

    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{"launch":"pwa"}');
    expect(init.credentials).toBe("omit");
    expect(touched).toEqual([]);
  });

  it("no marker → an empty body; an unsafe marker is not forwarded", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await sendLaunchBeacon("/d", { search: "", fetchImpl });
    await sendLaunchBeacon("/d", { search: "?src=%3Cscript%3E", fetchImpl });
    const bodies = fetchImpl.mock.calls.map((c) => (c as unknown as [string, RequestInit])[1].body);
    expect(bodies).toEqual(["{}", "{}"]);
  });

  it("never throws into the page: a failing fetch returns false", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); });
    await expect(sendLaunchBeacon("/d", { search: "?src=pwa", fetchImpl })).resolves.toBe(false);
  });
});

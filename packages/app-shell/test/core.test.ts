// F092 core: navigation rules, the notification contract and its sources,
// initials, and two guards on the package as a whole (no Gravatar, no colour
// literals in the CSS).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  isExternal,
  safeNavigate,
  badgeLabel,
  createFetchNotificationSource,
  createMemoryNotificationSource,
  initials,
  isActivePath,
  relativeTime,
} from "../src/index";

describe("isActivePath", () => {
  it.each([
    ["/", "/", true],
    ["/", "/board", false],
    ["/board", "/board", true],
    ["/board", "/board/123", true],
    ["/board", "/boardroom", false],
    ["/board", "/board?x=1", true],
    ["/board/", "/board", true],
  ])("%s on %s → %s", (href, path, want) => {
    expect(isActivePath(href, path)).toBe(want);
  });
});

describe("badgeLabel", () => {
  it.each([[undefined, null], [0, null], [-1, null], [7, "7"], [99, "99"], [100, "99+"]] as const)("%s → %s", (n, want) => {
    expect(badgeLabel(n)).toBe(want);
  });
});

describe("initials (no Gravatar, D-1dc849)", () => {
  it.each([
    ["Christian Broberg", undefined, "CB"],
    ["Christian Høj Broberg", undefined, "CB"],
    ["madonna", undefined, "M"],
    [undefined, "anna.berg@x.dk", "AB"],
    ["", "", "?"],
  ])("%s / %s → %s", (name, email, want) => {
    expect(initials(name, email)).toBe(want);
  });
});

const row = (id: string, seenAt: number | null = null) => ({ id, kind: "test", title: id.toUpperCase(), body: null, navigate: `/${id}`, refId: null, createdAt: 0, seenAt });

describe("createFetchNotificationSource — the default source (shaped after @broberg/notifications)", () => {
  const items = [row("n1"), row("n2", 5)];
  function fake(status = 200, body: unknown = { items, unseen: 1 }) {
    const calls: string[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}${init?.body ? " " + String(init.body) : ""}`);
      return new Response(JSON.stringify(String(input).includes("/seen") ? { clearedIds: ["n1"], count: 0 } : body), { status });
    }) as typeof fetch;
    return { f, calls };
  }

  it("GET url → rows and the server's count; seen and seen-all hit the documented paths", async () => {
    const { f, calls } = fake();
    const s = createFetchNotificationSource({ url: "/api/notifications/", fetch: f, pollMs: 0 });
    expect(await s.loadRows()).toEqual(items);
    expect(await s.countUnseen()).toBe(1);
    expect(await s.markSeen(["n1"])).toEqual(["n1"]);
    expect(await s.markAllSeen()).toEqual(["n1"]);
    expect(calls).toEqual([
      "GET /api/notifications",
      "GET /api/notifications",
      'POST /api/notifications/seen {"ids":["n1"]}',
      "POST /api/notifications/seen-all",
    ]);
  });

  it("the server's count wins over counting rows (muted kinds, F074's counting rule)", async () => {
    const s = createFetchNotificationSource({ url: "/n", fetch: fake(200, { items: [row("a"), row("b")], unseen: 1 }).f });
    expect(await s.countUnseen()).toBe(1);
  });

  it("a failed load THROWS — never an empty list", async () => {
    await expect(createFetchNotificationSource({ url: "/n", fetch: fake(500).f }).loadRows()).rejects.toThrow("HTTP 500");
    await expect(createFetchNotificationSource({ url: "/n", fetch: fake(200, { nope: 1 }).f }).loadRows()).rejects.toThrow("response has no items array");
  });
});

describe("createMemoryNotificationSource", () => {
  it("marks seen (returning only the ids that transitioned), marks all, notifies", async () => {
    const s = createMemoryNotificationSource([row("a"), row("b"), row("c", 1)]);
    let calls = 0;
    const off = s.subscribe!(() => calls++);
    expect(await s.markSeen(["a", "c"])).toEqual(["a"]);
    expect(await s.countUnseen()).toBe(1);
    expect(await s.markAllSeen()).toEqual(["b"]);
    expect(await s.countUnseen()).toBe(0);
    off();
    s.push(row("d"));
    expect(calls).toBe(2);
    expect(await s.countUnseen()).toBe(1);
  });
});

describe("safeNavigate — a notification link is server data", () => {
  it("follows same-site paths and http(s), refuses everything else", () => {
    expect(["/a", "/a?b=1#c", " /x ", "https://bid.broberg.ai/k", "http://localhost:3000/"].map(safeNavigate)).toEqual(
      ["/a", "/a?b=1#c", "/x", "https://bid.broberg.ai/k", "http://localhost:3000/"],
    );
    for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.example/x", "/\\evil.example", "relative", "", null, undefined]) {
      expect(safeNavigate(bad as string)).toBeNull();
    }
  });
});

describe("isExternal (F092.10, D-d28547)", () => {
  it("only an http(s) link to another origin leaves the app", () => {
    const o = "https://app.example";
    const cases: Array<[string, boolean]> = [
      ["https://id.broberg.ai/account", true],
      ["http://other.example/x", true],
      ["//evil.example/x", true],
      ["https://app.example/settings", false],
      ["/account", false],
      ["account", false],
      ["#top", false],
      ["mailto:a@b.dk", false],
      ["tel:+4512345678", false],
    ];
    expect(cases.map(([h]) => [h, isExternal(h, o)])).toEqual(cases);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it.each([
    ["2026-10-05T11:59:30Z", "nu"],
    ["2026-10-05T11:55:00Z", "5 min"],
    ["2026-10-05T09:00:00Z", "3 t"],
    ["2026-10-04T10:00:00Z", "i går"],
    ["2026-10-01T12:00:00Z", "4 d"],
  ])("%s → %s", (ts, want) => {
    expect(relativeTime(ts, "da", now)).toBe(want);
  });
});

describe("package-wide guards", () => {
  const src = readdirSync(join(__dirname, "../src")).map((f) => readFileSync(join(__dirname, "../src", f), "utf8")).join("\n");
  it("no Gravatar anywhere in the source (owner decision D-1dc849)", () => {
    expect(src.toLowerCase()).not.toMatch(/gravatar\.com|@broberg\/gravatar|from ["'].*gravatar/);
  });
  it("the CSS writes no colour literal — every colour is a theme token", () => {
    const css = readFileSync(join(__dirname, "../css/app-shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });
  // appkit 5/10, measured at 393px and 1440px in Lens screenshots.
  const css = readFileSync(join(__dirname, "../css/app-shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === sel).map((m) => m[2]);
  it("closed phone drawer casts no shadow at the screen edge and is hidden", () => {
    const closed = rule(".bas-sidebar.is-mobile-drawer").join(";");
    expect(closed).not.toMatch(/box-shadow/);
    expect(closed).toMatch(/visibility:\s*hidden/);
    expect(rule(".bas-sidebar.is-mobile-drawer.is-open").join(";")).toMatch(/visibility:\s*visible/);
  });
  it("F092.12: no bar the bell lives in is a containing block for position:fixed — the blur is on ::before", () => {
    const CB = /(^|;)\s*(backdrop-filter|-webkit-backdrop-filter|filter|transform|perspective|contain|will-change)\s*:/;
    for (const sel of [".bas-topbar", '.bas-root[data-layout="inset"] .bas-contenthead', ".bas-contenthead", ".bas-bell"]) {
      for (const body of rule(sel)) expect([sel, CB.test(body)]).toEqual([sel, false]);
    }
    const before = rule('.bas-topbar::before,\n.bas-root[data-layout="inset"] .bas-contenthead::before').join(";");
    expect(before).toMatch(/backdrop-filter:\s*blur\(8px\)/);
    expect(before).toMatch(/z-index:\s*-1/);
  });
  it("the sidebar sits above <main> (its sticky stacking context caps the rail flyout), below the top bar", () => {
    const z = (sel: string) => Number(/z-index:\s*(\d+)/.exec(rule(sel).join(";"))?.[1]);
    expect(z(".bas-sidebar")).toBeGreaterThan(0);
    expect(z(".bas-sidebar")).toBeLessThan(z(".bas-topbar"));
  });
  it("the button font reset has zero specificity, so .bas-item's size wins on a parent item", () => {
    expect(rule(":where(.bas-root button)").join(";")).toMatch(/font:\s*inherit/);
    expect(css).not.toMatch(/(^|\n)\.bas-root button\s*\{/);
  });
  it("drawer mode shows the brand once on desktop: sidebar brand hidden outside the phone query", () => {
    const desktop = css.split("@media")[0];
    // topbar layout only: in "inset" (F092.8) the sidebar IS where the brand lives
    expect(desktop).toMatch(/\.bas-root\[data-layout="topbar"\]\[data-mobile="drawer"\] \.bas-sidebar__brand \{ display: none; \}/);
    expect(rule('.bas-root[data-layout="topbar"][data-mobile="drawer"] .bas-sidebar__brand')).toContain(" display: block; ");
  });
});

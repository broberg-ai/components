// F038.29 — the BID ticket registry: live from BID, three distinct states, behind login.
import { describe, expect, it, vi } from "vitest";
process.env.ENROLL_DB_URL = ":memory:";
import { app, setTicketRegistryForTests } from "./server";
import { getEnrollStore } from "./enroll";
import { createTicketRegistry, NOT_CONFIGURED_MESSAGE } from "./ticket-registry";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SITE_CSS } from "../../scripts/site-chrome.mjs";

const BID = "https://id.example/api/tickets/registry";
const FAKE = {
  generatedAt: "2026-10-22T11:00:00.000Z",
  rules: [
    { app: "broberg-field", type: "service", audience: "cronjobs", scopes: ["cronjobs:read", "cronjobs:write"], since: "2026-10-01" },
    { app: "broberg-ai/components", type: "github", audience: "discovery", scopes: ["discovery:read"], since: "2026-10-08" },
    { app: "jam", type: "user", audience: "cardmem", scopes: ["cardmem:mockups:read"], since: "2026-10-20" },
  ],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createTicketRegistry", () => {
  it("ok: returns BID's rules exactly, fetched with Discovery's own ticket", async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer svc-ticket");
      return json(FAKE);
    });
    const r = createTicketRegistry({ url: BID, getToken: async () => "svc-ticket", fetchImpl: fetchImpl as never, now: () => 1_000 });
    const s = await r.get();
    expect(s).toEqual({ status: "ok", source: BID, generatedAt: FAKE.generatedAt, fetchedAt: new Date(1_000).toISOString(), rules: FAKE.rules });
  });

  it("caches a good answer for the TTL, then asks BID again", async () => {
    let t = 0;
    const fetchImpl = vi.fn(async () => json(FAKE));
    const r = createTicketRegistry({ url: BID, getToken: async () => "x", fetchImpl: fetchImpl as never, now: () => t, ttlMs: 300_000 });
    await r.get();
    t = 299_000;
    await r.get();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t = 300_001;
    await r.get();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("not_configured when the endpoint is not wired — never an empty list", async () => {
    const s = await createTicketRegistry({}).get();
    expect(s).toEqual({ status: "not_configured", message: NOT_CONFIGURED_MESSAGE });
    expect("rules" in s).toBe(false);
  });

  it("BID down: error with 'never' before any good answer, and the time of the last good one after", async () => {
    let t = 0;
    let up = false;
    const fetchImpl = vi.fn(async () => { if (!up) throw new Error("ECONNREFUSED"); return json(FAKE); });
    const r = createTicketRegistry({ url: BID, getToken: async () => "x", fetchImpl: fetchImpl as never, now: () => t, ttlMs: 1 });
    const first = await r.get();
    expect(first).toEqual({ status: "error", source: BID, error: "unreachable: ECONNREFUSED", lastGoodAt: null });
    up = true; t = 5_000;
    await r.get();
    up = false; t = 9_000;
    const later = await r.get();
    expect(later).toMatchObject({ status: "error", lastGoodAt: new Date(5_000).toISOString() });
    expect("rules" in later).toBe(false);
  });

  it("BID refuses (403) or sends a wrong shape: error, not an empty list", async () => {
    const refused = createTicketRegistry({ url: BID, getToken: async () => "x", fetchImpl: (async () => json({ error: "forbidden" }, 403)) as never });
    expect(await refused.get()).toMatchObject({ status: "error", error: "BID answered 403" });
    const odd = createTicketRegistry({ url: BID, getToken: async () => "x", fetchImpl: (async () => json({ generatedAt: "x", rules: [{ app: "a" }] })) as never });
    expect(await odd.get()).toMatchObject({ status: "error", error: "BID's answer did not have the agreed shape" });
  });
});

describe("shape check", () => {
  it("a rule with a type outside service/github/user/login is refused as a wrong shape", async () => {
    const bad = { generatedAt: "x", rules: [{ ...FAKE.rules[0], type: "admin" }] };
    const r = createTicketRegistry({ url: BID, getToken: async () => "x", fetchImpl: (async () => json(bad)) as never });
    expect(await r.get()).toMatchObject({ status: "error", error: "BID's answer did not have the agreed shape" });
  });
});

describe("/tickets and /api/tickets", () => {
  const sha = (k: string) => createHash("sha256").update(k).digest("hex");
  const login = async () => {
    await (await getEnrollStore())!.bindSessionKey("t-reader", sha("k".repeat(64)));
    return { "x-discovery-session": "t-reader", "x-enroll-key": "k".repeat(64) };
  };

  it("are behind the same login as the rest of Discovery", async () => {
    expect((await app.request("/api/tickets")).status).toBe(401);
    expect((await app.request("/tickets")).status).toBe(401);
  });

  it("show not_configured honestly while BID's endpoint is not wired", async () => {
    setTicketRegistryForTests(createTicketRegistry({}));
    const h = await login();
    expect(await (await app.request("/api/tickets", { headers: h })).json()).toEqual({ status: "not_configured", message: NOT_CONFIGURED_MESSAGE });
    const html = await (await app.request("/tickets", { headers: h })).text();
    expect(html).toContain('data-testid="tickets-root"');
    expect(html).toContain('data-status="not_configured"');
    expect(html).not.toContain('data-testid="tickets-table"');
  });

  it("render one row per BID rule when BID answers", async () => {
    setTicketRegistryForTests(createTicketRegistry({ url: BID, getToken: async () => "x", fetchImpl: (async () => json(FAKE)) as never }));
    const h = await login();
    const html = await (await app.request("/tickets", { headers: h })).text();
    expect(html.match(/data-testid="tickets-row-\d+"/g)?.length).toBe(3);
    expect(html).toContain("<td>broberg-field</td><td>tjeneste (Fly OIDC)</td><td>cronjobs</td>");
    expect(html).toContain("<td>jam</td><td>bruger-billet</td>");
  });
});

// F038.30 — Christian 23/10: same design as the site, in the menu, and in llms.txt.
describe("F038.30 — /tickets in the site's design, in the menu, in llms.txt", () => {
  const sha = (k: string) => createHash("sha256").update(k).digest("hex");
  const login = async () => {
    await (await getEnrollStore())!.bindSessionKey("t-reader2", sha("q".repeat(64)));
    return { "x-discovery-session": "t-reader2", "x-enroll-key": "q".repeat(64) };
  };
  const okRegistry = () => createTicketRegistry({ url: BID, getToken: async () => "x", fetchImpl: (async () => json(FAKE)) as never });

  it("/tickets carries the site's own CSS (one source) and its top bar, with itself marked as the current page", async () => {
    setTicketRegistryForTests(okRegistry());
    const html = await (await app.request("/tickets", { headers: await login() })).text();
    expect(html).toContain(SITE_CSS);
    expect(html).toContain('<div class="top"><div class="wrap">');
    expect(html).toMatch(/<a href="\/tickets" data-testid="nav-tickets" aria-current="page"/);
    expect(html).toContain('id="mode"');
    expect(html.match(/data-testid="tickets-row-\d+"/g)?.length).toBe(3);
  });

  it("the landing page's menu links to /tickets — and so does the committed build", () => {
    const landing = readFileSync(new URL("../../docs/inventory.html", import.meta.url), "utf8");
    expect(landing).toMatch(/<a href="\/tickets" data-testid="nav-tickets"/);
    expect(landing).toContain(SITE_CSS);
  });

  it("/llms.txt, /llms-full.txt and /ai end with the LIVE rules — one line each, count = /api/tickets", async () => {
    setTicketRegistryForTests(okRegistry());
    const h = await login();
    const api = (await (await app.request("/api/tickets", { headers: h })).json()) as { rules: unknown[] };
    for (const path of ["/llms.txt", "/llms-full.txt", "/ai"]) {
      const txt = await (await app.request(path, { headers: h })).text();
      const section = txt.slice(txt.indexOf("## Hvem logger ind med BID-billetter"));
      expect(section.startsWith("## Hvem logger ind med BID-billetter (live fra BID)")).toBe(true);
      expect(section.match(/^- \*\*/gm)?.length).toBe(api.rules.length);
      expect(section).toContain("- **broberg-field** · tjeneste (Fly OIDC) · modtager cronjobs · scopes cronjobs:read, cronjobs:write · siden 2026-10-01");
    }
  });

  it("BID down: llms.txt says so honestly — never an empty list that reads as 'nobody'", async () => {
    setTicketRegistryForTests(createTicketRegistry({ url: BID, getToken: async () => "x", fetchImpl: (async () => json({}, 503)) as never }));
    const txt = await (await app.request("/llms.txt", { headers: await login() })).text();
    const section = txt.slice(txt.indexOf("## Hvem logger ind med BID-billetter"));
    expect(section).toContain("Kunne ikke hente fra BID: BID answered 503");
    expect(section).toContain("Listen er IKKE tom");
    expect(section).not.toMatch(/^- \*\*/m);
  });
});

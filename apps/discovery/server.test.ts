import { describe, expect, it } from "vitest";

// F039 enroll store: in-memory libSQL for tests (the lazy store reads this at
// first use, so setting it at module scope is enough). Auth is per-session
// trust-on-first-use — no central key env.
process.env.ENROLL_DB_URL = ":memory:";

import { app } from "./server";

describe("Discovery API", () => {
  it("GET /health → ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("GET /api/components?q=mail → finds @broberg/mail", async () => {
    const res = await app.request("/api/components?q=mail");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThan(0);
    const mail = body.components.find((c: { package: string }) => c.package === "@broberg/mail");
    expect(mail).toBeTruthy();
    expect(mail.status).toBe("shipped");
    expect(mail.id).toBe("F005");
  });

  it("ranks an exact name/package match above a description-only hit (q=lens → lens first, not mail)", async () => {
    const pkgs = (await (await app.request("/api/packages?q=lens")).json()).packages;
    expect(pkgs[0].name).toBe("@broberg/lens");
    const comps = (await (await app.request("/api/components?q=lens")).json()).components;
    expect(comps[0].package).toBe("@broberg/lens");
  });

  it("Trail is a searchable capability (q=memory/rag/second-brain surfaces it)", async () => {
    for (const q of ["memory", "rag", "second-brain"]) {
      const comps = (await (await app.request(`/api/search?q=${q}`)).json()).components;
      expect(comps.some((c: { id: string }) => c.id === "trail")).toBe(true);
    }
  });

  it("GET /api/components?status=shipped&layer=L0 filters", async () => {
    const res = await app.request("/api/components?status=shipped&layer=L0");
    const body = await res.json();
    expect(body.components.every((c: { status: string; layer: string }) => c.status === "shipped" && c.layer === "L0")).toBe(true);
    expect(body.components.some((c: { package: string }) => c.package === "@broberg/theme")).toBe(true);
  });

  it("GET /api/components/:id resolves a slug and 404s otherwise", async () => {
    const ok = await app.request("/api/components/seti-server");
    expect(ok.status).toBe(200);
    expect((await ok.json()).package).toBe("@broberg/seti-server");
    const miss = await app.request("/api/components/nope");
    expect(miss.status).toBe(404);
  });

  it("GET /api/packages → shipped npms with versions", async () => {
    const res = await app.request("/api/packages");
    const body = await res.json();
    const mail = body.packages.find((p: { name: string }) => p.name === "@broberg/mail");
    expect(mail.version).toBe("0.1.0");
    expect(body.packages.every((p: { version: string | null }) => p.version)).toBe(true);
  });

  it("GET /api/fleet → roster includes fdaa (new)", async () => {
    const res = await app.request("/api/fleet");
    const body = await res.json();
    const fdaa = body.fleet.find((f: { s: string }) => f.s === "fdaa");
    expect(fdaa).toBeTruthy();
    expect(fdaa.isNew).toBe(true);
  });

  it("GET /api/search?q=lens → spans components + fleet", async () => {
    const res = await app.request("/api/search?q=lens");
    const body = await res.json();
    expect(body.components.some((c: { package: string }) => c.package === "@broberg/lens")).toBe(true);
    expect(body.fleet.length).toBeGreaterThan(0);
  });

  it("GET /api/search with no q → 400", async () => {
    expect((await app.request("/api/search")).status).toBe(400);
  });

  it("GET /api/stats → totals", async () => {
    const res = await app.request("/api/stats");
    const body = await res.json();
    expect(body.components).toBeGreaterThan(40);
    expect(body.shipped).toBeGreaterThanOrEqual(11);
  });

  it("GET / → serves the dashboard landing page (HTML)", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Component Universe");
  });

  it("GET / with Accept: application/json → the self-describing manifest", async () => {
    const res = await app.request("/", { headers: { accept: "application/json" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe("discovery.broberg.ai");
    expect(Array.isArray(body.endpoints)).toBe(true);
    // the root must hand the caller the searchable vocabulary
    expect(body.vocabularies.statuses).toContain("shipped");
    expect(body.vocabularies.infra.some((i: { id: string }) => i.id === "fly")).toBe(true);
    expect(body.vocabularies.layers.length).toBeGreaterThan(0);
  });

  it("GET /api → manifest lists every endpoint + vocabularies", async () => {
    const body = await (await app.request("/api")).json();
    const paths = body.endpoints.map((e: { path: string }) => e.path);
    expect(paths).toContain("/api/infra");
    expect(paths).toContain("/api/search");
    expect(body.stats.infraPlatforms).toBe(7);
  });

  it("GET /api/infra → platforms incl. fly with tipCount", async () => {
    const body = await (await app.request("/api/infra")).json();
    const fly = body.infra.find((p: { id: string }) => p.id === "fly");
    expect(fly).toBeTruthy();
    expect(fly.tipCount).toBeGreaterThan(0);
    expect(fly.tips).toBeUndefined(); // summary list omits the long tips
  });

  it("GET /api/infra/:id → full tips + notes, 404 otherwise", async () => {
    const fly = await (await app.request("/api/infra/fly")).json();
    expect(fly.region).toContain("arn");
    expect(fly.tips.length).toBeGreaterThan(0);
    expect(fly.notes).toBeTruthy();
    expect((await app.request("/api/infra/nope")).status).toBe(404);
  });

  it("GET /api/search?q=deploy → spans infra too", async () => {
    const body = await (await app.request("/api/search?q=deploy")).json();
    expect(body.infra.some((p: { id: string }) => p.id === "fly")).toBe(true);
  });

  it("tokenizes natural phrases — q='send email' surfaces @broberg/mail (Trail's gap)", async () => {
    const comps = (await (await app.request("/api/components?q=send%20email")).json()).components;
    expect(comps.some((c: { package: string }) => c.package === "@broberg/mail")).toBe(true);
    const search = await (await app.request("/api/search?q=send%20email")).json();
    expect(search.components.some((c: { package: string }) => c.package === "@broberg/mail")).toBe(true);
  });

  it("aliases resolve synonyms — 'dark mode' → theme, 'screenshot' → lens, 'authentication' → oauth", async () => {
    const theme = (await (await app.request("/api/components?q=dark%20mode")).json()).components;
    expect(theme.some((c: { package: string }) => c.package === "@broberg/theme")).toBe(true);
    const lens = (await (await app.request("/api/components?q=screenshot")).json()).components;
    expect(lens.some((c: { package: string }) => c.package === "@broberg/lens")).toBe(true);
    const oauth = (await (await app.request("/api/components?q=authentication")).json()).components;
    expect(oauth.some((c: { package: string }) => c.package === "@broberg/oauth")).toBe(true);
  });

  it("infra aliases — 'postgres' → supabase, 'hosting' → fly", async () => {
    const s = await (await app.request("/api/search?q=postgres")).json();
    expect(s.infra.some((p: { id: string }) => p.id === "supabase")).toBe(true);
    const infra = (await (await app.request("/api/infra?q=hosting")).json()).infra;
    expect(infra.some((p: { id: string }) => p.id === "fly")).toBe(true);
  });

  it("infra search is noise-free — a stray token can't substring-hit long-form notes ('dark' ≠ 'ship-dark')", async () => {
    const body = await (await app.request("/api/search?q=dark%20mode")).json();
    // theme still wins the component result …
    expect(body.components.some((c: { package: string }) => c.package === "@broberg/theme")).toBe(true);
    // … but no infra platform should be dragged in via 'ship-dark'/'sends' substrings
    expect(body.infra.length).toBe(0);
  });

  it("exposes keywords/aliases on components for discoverability", async () => {
    const mail = await (await app.request("/api/components/F005")).json();
    expect(Array.isArray(mail.keywords)).toBe(true);
    expect(mail.keywords).toContain("email");
  });

  it("components carry npm + PUBLIC-repo links; a private repo gets npmUrl but no repoUrl", async () => {
    const apikey = await (await app.request("/api/components/F010")).json();
    expect(apikey.npmUrl).toBe("https://www.npmjs.com/package/@broberg/apikey");
    expect(apikey.repoUrl).toBe("https://github.com/broberg-ai/components");
    // @broberg/complimenta-sdk is published (public on npm) but its repo (broberg-ai/fdaa) is PRIVATE → no repo link (would 404)
    const comp = await (await app.request("/api/components/complimenta-sdk")).json();
    expect(comp.npmUrl).toBe("https://www.npmjs.com/package/@broberg/complimenta-sdk");
    expect(comp.repoUrl).toBeNull();
    // /api/packages carries the links too
    const pkgs = (await (await app.request("/api/packages")).json()).packages;
    expect(pkgs.find((p: { name: string }) => p.name === "@broberg/apikey").npmUrl).toBeTruthy();
  });
});

describe("auto-enrollment (F039) — trust-on-first-use keys", () => {
  // Each session brings its OWN ≥32-char key (openssl rand -hex 32). TOFU binds
  // it on first contact. Distinct session names per test keep the shared
  // in-memory store from coupling tests.
  const KEY = "a".repeat(64);
  const KEY2 = "b".repeat(64);
  const enroll = (body: object, key: string | null = KEY) =>
    app.request("/api/enroll", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "x-enroll-key": key } : {}) },
      body: JSON.stringify(body),
    });

  it("missing or too-short key → 401", async () => {
    expect((await enroll({ session: "t-nokey", pkg: "@broberg/mail", version: "0.1.0" }, null)).status).toBe(401);
    expect((await enroll({ session: "t-short", pkg: "@broberg/mail", version: "0.1.0" }, "short")).status).toBe(401);
  });

  it("unknown package → 400 (rejected before any key is bound)", async () => {
    expect((await enroll({ session: "t-unknown", pkg: "@broberg/nope", version: "1.0.0" })).status).toBe(400);
  });

  it("first enroll binds the session's key (TOFU) + shows in roster/status, excluded from gap", async () => {
    const res = await enroll({ session: "trail-test", pkg: "@broberg/mail", version: "0.1.0", role: "uses", commit: "f776213" });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.key).toBe("registered");
    expect(j.enrollment.pkg).toBe("@broberg/mail");

    const roster = await (await app.request("/api/enrollments")).json();
    expect(roster.enrollments.some((e: { session: string; pkg: string }) => e.session === "trail-test" && e.pkg === "@broberg/mail")).toBe(true);

    const status = await (await app.request("/api/sessions/trail-test")).json();
    expect(status.enrolled.some((e: { pkg: string }) => e.pkg === "@broberg/mail")).toBe(true);
    expect(status.gap.some((g: { package: string }) => g.package === "@broberg/mail")).toBe(false);
    expect(status.gap.length).toBeGreaterThan(0);
  });

  it("same session + same key → matched, idempotent (no duplicate row)", async () => {
    const res = await enroll({ session: "trail-test", pkg: "@broberg/mail", version: "0.2.0" });
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe("matched");
    const roster = await (await app.request("/api/enrollments")).json();
    const rows = roster.enrollments.filter((e: { session: string; pkg: string }) => e.session === "trail-test" && e.pkg === "@broberg/mail");
    expect(rows.length).toBe(1);
    expect(rows[0].version).toBe("0.2.0");
  });

  it("same session + a DIFFERENT key → 401 mismatch (can't hijack a bound session)", async () => {
    const res = await enroll({ session: "trail-test", pkg: "@broberg/lens", version: "0.1.2" }, KEY2);
    expect(res.status).toBe(401);
  });

  it("a different session binds its own key independently", async () => {
    const res = await enroll({ session: "other-test", pkg: "@broberg/config", version: "0.1.1" }, KEY2);
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe("registered");
  });

  it("the manifest advertises the enroll endpoints", async () => {
    const paths = (await (await app.request("/api")).json()).endpoints.map((e: { path: string }) => e.path);
    expect(paths).toContain("/api/enroll");
    expect(paths).toContain("/api/enrollments");
    expect(paths).toContain("/api/sessions/:session");
  });

  it("a session's own published packages are excluded from its gap (ai-sdk #5335)", async () => {
    const owner = await (await app.request("/api/sessions/ai-sdk")).json();
    expect(owner.owns).toContain("@broberg/ai-sdk");
    expect(owner.gap.some((g: { package: string }) => g.package === "@broberg/ai-sdk")).toBe(false);
    // a non-owning session still sees that package in its gap
    const other = await (await app.request("/api/sessions/nobody-owns-this")).json();
    expect(other.owns).toEqual([]);
    expect(other.gap.some((g: { package: string }) => g.package === "@broberg/ai-sdk")).toBe(true);
  });
});

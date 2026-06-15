import { describe, expect, it } from "vitest";
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
    expect(body.stats.infraPlatforms).toBe(6);
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
});

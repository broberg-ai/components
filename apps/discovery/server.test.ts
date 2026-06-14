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
});

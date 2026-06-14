// discovery.broberg.ai — the broberg.ai shared-component Discovery API (F038).
// Read-only, stateless: the inventory is compiled in from the single source
// (scripts/inventory-data.mjs — the same data the dashboard renders). Any repo
// (human or cc-session) queries this BEFORE building, to reuse > re-roll.
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
// Single source of truth — shared with scripts/build-inventory.mjs.
import { DATA, FLEET, MODEL } from "../../scripts/inventory-data.mjs";

const VERSION = "0.1.0";

// The shared data is plain JS (one source for the dashboard + this API); give it
// a shape here so TS knows the optional fields.
type RawItem = {
  f: string; nm: string; m: string; desc?: string; pkg?: string; e?: string; i?: string;
  s?: string; ver?: string; src?: string; own?: string; grad?: number; ext?: number; note?: string;
};
type RawLayer = { n: string; t: string; d: string; items: RawItem[] };
const LAYERS = DATA as RawLayer[];
const MODELS = MODEL as Record<string, string>;

// Flatten the layered DATA into a flat, queryable component list.
const components = LAYERS.flatMap((L) =>
  L.items.map((it) => ({
    id: it.f,
    name: it.nm,
    package: it.pkg ?? null,
    layer: L.n,
    layerName: L.t,
    model: it.m,
    modelDesc: MODELS[it.m] ?? null,
    effort: it.e ?? null,
    impact: it.i ?? null,
    status: it.s === "shipped" ? "shipped" : it.s === "moved" ? "moved" : "backlog",
    version: it.ver ?? null,
    source: it.src ?? null,
    owner: it.own ?? null,
    graduate: !!it.grad,
    external: !!it.ext,
    note: it.note ?? null,
    description: it.desc ?? null,
  })),
);

// The shipped npm packages (the "what can I install right now" view).
const packages = components
  .filter((c) => c.package && c.status === "shipped")
  .map((c) => ({
    name: c.package,
    version: c.version,
    owner: c.owner,
    component: c.id,
    layer: c.layer,
    description: c.description,
  }));

const layers = LAYERS.map((L) => ({ id: L.n, name: L.t, description: L.d, count: L.items.length }));

const stats = {
  components: components.length,
  shipped: components.filter((c) => c.status === "shipped").length,
  backlog: components.filter((c) => c.status === "backlog").length,
  moved: components.filter((c) => c.status === "moved").length,
  packages: packages.length,
  fleetSessions: FLEET.length,
  layers: layers.length,
};

const matches = (c: (typeof components)[number], q: string) => {
  const hay = `${c.id} ${c.name} ${c.package ?? ""} ${c.owner ?? ""} ${c.description ?? ""}`.toLowerCase();
  return hay.includes(q.toLowerCase());
};

// Landing page = the live dashboard (same single source). node:fs so it works
// under both Bun (prod) and node (vitest).
let LANDING = "";
try {
  LANDING = readFileSync(new URL("../../docs/inventory.html", import.meta.url), "utf8");
} catch {
  LANDING = "<!doctype html><title>discovery.broberg.ai</title><p>Inventory dashboard unavailable.</p>";
}

const app = new Hono();
app.use("/api/*", cors()); // public read-only catalogue — any repo/browser may query

app.get("/", (c) => c.html(LANDING));

app.get("/health", (c) => c.json({ ok: true, service: "discovery", version: VERSION }));

app.get("/api", (c) =>
  c.json({
    service: "discovery.broberg.ai",
    description: "Read-only Discovery API for the broberg.ai shared component inventory. Reuse > re-roll.",
    version: VERSION,
    stats,
    endpoints: {
      "GET /api/components": "all components; filter with ?q= &layer= &status= &model=",
      "GET /api/components/:id": "one component by id (F-number or slug, e.g. F005, mail, seti-server)",
      "GET /api/packages": "shipped @broberg/* + sibling npm packages (name, version, owner)",
      "GET /api/fleet": "the fleet roster — who builds & consumes the shared library",
      "GET /api/layers": "the inventory layers (L0 Rails … L4 Capstone, SDK)",
      "GET /api/stats": "totals",
      "GET /api/search?q=": "search components + packages + fleet",
    },
  }),
);

app.get("/api/components", (c) => {
  const q = c.req.query("q");
  const layer = c.req.query("layer");
  const status = c.req.query("status");
  const model = c.req.query("model");
  let out = components;
  if (layer) out = out.filter((x) => x.layer.toLowerCase() === layer.toLowerCase());
  if (status) out = out.filter((x) => x.status === status.toLowerCase());
  if (model) out = out.filter((x) => x.model === model.toLowerCase());
  if (q) out = out.filter((x) => matches(x, q));
  return c.json({ count: out.length, components: out });
});

app.get("/api/components/:id", (c) => {
  const id = c.req.param("id").toLowerCase();
  const hit = components.find((x) => x.id.toLowerCase() === id);
  if (!hit) return c.json({ error: "not_found", id }, 404);
  return c.json(hit);
});

app.get("/api/packages", (c) => {
  const q = c.req.query("q");
  const out = q ? packages.filter((p) => `${p.name} ${p.description ?? ""}`.toLowerCase().includes(q.toLowerCase())) : packages;
  return c.json({ count: out.length, packages: out });
});

app.get("/api/fleet", (c) => c.json({ count: FLEET.length, fleet: FLEET }));

app.get("/api/layers", (c) => c.json({ count: layers.length, layers }));

app.get("/api/stats", (c) => c.json(stats));

app.get("/api/search", (c) => {
  const q = c.req.query("q") ?? "";
  if (!q) return c.json({ error: "q_required" }, 400);
  const ql = q.toLowerCase();
  return c.json({
    query: q,
    components: components.filter((x) => matches(x, q)),
    packages: packages.filter((p) => `${p.name} ${p.description ?? ""}`.toLowerCase().includes(ql)),
    fleet: FLEET.filter((f) => `${f.s} ${f.r}`.toLowerCase().includes(ql)),
  });
});

export default { port: Number(process.env.PORT) || 3000, fetch: app.fetch };
export { app };

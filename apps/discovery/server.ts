// discovery.broberg.ai — the broberg.ai shared-component Discovery API (F038).
// Read-only, stateless: the inventory is compiled in from the single source
// (scripts/inventory-data.mjs — the same data the dashboard renders). Any repo
// (human or cc-session) queries this BEFORE building, to reuse > re-roll.
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
// Single source of truth — shared with scripts/build-inventory.mjs.
import { DATA, FLEET, MODEL, INFRA } from "../../scripts/inventory-data.mjs";

const VERSION = "0.2.0";

// The shared data is plain JS (one source for the dashboard + this API); give it
// a shape here so TS knows the optional fields.
type RawItem = {
  f: string; nm: string; m: string; desc?: string; pkg?: string; e?: string; i?: string;
  s?: string; ver?: string; src?: string; own?: string; grad?: number; ext?: number; note?: string; dist?: string;
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
    dist: it.dist ?? (it.pkg ? "npm" : null),
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
    dist: c.dist ?? "npm",
    install:
      c.dist === "spm"
        ? `.package(url: "https://github.com/${c.source}", from: "${c.version}")`
        : `npm i ${c.package}`,
    owner: c.owner,
    component: c.id,
    layer: c.layer,
    description: c.description,
  }));

const layers = LAYERS.map((L) => ({ id: L.n, name: L.t, description: L.d, count: L.items.length }));

type InfraTip = { t: string; by?: string; tag?: string };
type InfraPlatform = { id: string; name: string; role: string; region?: string; notes?: string; tips?: InfraTip[] };
const infra = (INFRA as InfraPlatform[]).map((p) => ({ ...p, tipCount: (p.tips ?? []).length }));

const stats = {
  components: components.length,
  shipped: components.filter((c) => c.status === "shipped").length,
  backlog: components.filter((c) => c.status === "backlog").length,
  moved: components.filter((c) => c.status === "moved").length,
  packages: packages.length,
  fleetSessions: FLEET.length,
  infraPlatforms: infra.length,
  infraTips: infra.reduce((n, p) => n + p.tipCount, 0),
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

// The self-describing Discovery root: ONE call hands the caller every other call
// AND the values they can search by — so a session that doesn't yet know what
// exists can discover everything from here. This is the primary entry point.
const manifest = () => ({
  service: "discovery.broberg.ai",
  tagline: "Discover everything reusable across broberg.ai — query this BEFORE you build. Reuse > re-roll.",
  version: VERSION,
  start_here:
    "You are at the Discovery root. Every endpoint and every value you can filter by is listed below, so you can explore the whole inventory without knowing it in advance. Typical flow: GET /api/search?q=<what-you-need> → if nothing fits, you're clear to build (then tell components so it's added for everyone).",
  stats,
  endpoints: [
    { method: "GET", path: "/api", description: "this self-describing manifest — all endpoints + searchable vocabularies", example: "/api" },
    { method: "GET", path: "/api/components", description: "all components; filter with ?q= &layer= &status= &model=", example: "/api/components?q=mail&status=shipped" },
    { method: "GET", path: "/api/components/:id", description: "one component by F-number or slug", example: "/api/components/F005" },
    { method: "GET", path: "/api/packages", description: "installable packages with version + install string (npm or SwiftPM)", example: "/api/packages?q=lens" },
    { method: "GET", path: "/api/infra", description: "infra platforms we run on + best-practice tips & gotchas", example: "/api/infra" },
    { method: "GET", path: "/api/infra/:id", description: "one platform with its full tips + long-form notes", example: "/api/infra/fly" },
    { method: "GET", path: "/api/fleet", description: "the fleet roster — who builds & consumes the shared library", example: "/api/fleet" },
    { method: "GET", path: "/api/layers", description: "the inventory layers (L0 Rails … L4 Capstone, SDK)", example: "/api/layers" },
    { method: "GET", path: "/api/stats", description: "totals", example: "/api/stats" },
    { method: "GET", path: "/api/search", description: "search components + packages + fleet + infra in one call", example: "/api/search?q=deploy" },
  ],
  vocabularies: {
    layers: layers.map((l) => ({ id: l.id, name: l.name })),
    statuses: ["shipped", "backlog", "moved"],
    models: Object.keys(MODEL as Record<string, string>),
    infra: infra.map((p) => ({ id: p.id, name: p.name })),
    packages: packages.map((p) => p.name),
  },
});

const app = new Hono();
app.use("/api/*", cors()); // public read-only catalogue — any repo/browser may query
app.use("/", cors());

// Root: HTML dashboard for humans, the self-describing manifest for machines
// (Accept: application/json) — so the literal front door opens up for both.
app.get("/", (c) => {
  if ((c.req.header("accept") ?? "").includes("application/json")) return c.json(manifest());
  return c.html(LANDING);
});

app.get("/health", (c) => c.json({ ok: true, service: "discovery", version: VERSION }));

app.get("/api", (c) => c.json(manifest()));

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

app.get("/api/infra", (c) => {
  const q = c.req.query("q");
  const list = infra.map(({ notes, tips, ...rest }) => rest); // summary list (no long notes/tips)
  const out = q ? list.filter((p) => `${p.name} ${p.role}`.toLowerCase().includes(q.toLowerCase())) : list;
  return c.json({ count: out.length, infra: out });
});

app.get("/api/infra/:id", (c) => {
  const id = c.req.param("id").toLowerCase();
  const hit = infra.find((p) => p.id.toLowerCase() === id);
  if (!hit) return c.json({ error: "not_found", id }, 404);
  return c.json(hit);
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
    infra: infra.filter((p) =>
      `${p.name} ${p.role} ${p.notes ?? ""} ${(p.tips ?? []).map((t) => t.t).join(" ")}`.toLowerCase().includes(ql),
    ),
  });
});

export default { port: Number(process.env.PORT) || 3000, fetch: app.fetch };
export { app };

// discovery.broberg.ai — the broberg.ai shared-component Discovery API (F038).
// Read-only, stateless: the inventory is compiled in from the single source
// (scripts/inventory-data.mjs — the same data the dashboard renders). Any repo
// (human or cc-session) queries this BEFORE building, to reuse > re-roll.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
// Single source of truth — shared with scripts/build-inventory.mjs.
import { DATA, FLEET, MODEL, INFRA } from "../../scripts/inventory-data.mjs";
// F039 auto-enrollment write-layer (Turso/libSQL; ship-dark when unconfigured).
import { getEnrollStore, type Role } from "./enroll";

const VERSION = "0.3.0";

// The shared data is plain JS (one source for the dashboard + this API); give it
// a shape here so TS knows the optional fields.
type RawItem = {
  f: string; nm: string; m: string; desc?: string; pkg?: string; e?: string; i?: string;
  s?: string; ver?: string; src?: string; own?: string; grad?: number; ext?: number; note?: string; dist?: string;
  kw?: string[];
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
    keywords: it.kw ?? [], // search aliases — natural-language / synonym terms a session might type
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
    keywords: c.keywords,
  }));

// Known npm names — the enroll endpoint validates against these so the roster can't be polluted.
const packageNames = new Set(packages.map((p) => p.name).filter(Boolean) as string[]);

const layers = LAYERS.map((L) => ({ id: L.n, name: L.t, description: L.d, count: L.items.length }));

type InfraTip = { t: string; by?: string; tag?: string };
type InfraPlatform = { id: string; name: string; role: string; region?: string; notes?: string; tips?: InfraTip[]; kw?: string[] };
const infra = (INFRA as InfraPlatform[]).map((p) => ({ ...p, kw: p.kw ?? [], tipCount: (p.tips ?? []).length }));

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

// Split a query into words so a natural phrase ("send email") matches by its
// parts, not only as one literal substring. Drop 1-char noise.
const tokenize = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);

// Relevance scoring. An exact name/package/id match must beat a mere description
// hit (so q=lens tops @broberg/lens, not @broberg/mail whose blurb mentions lens),
// and an alias hit (kw) must rank well so synonyms/natural phrases resolve
// ("send email" → @broberg/mail, "dark mode" → @broberg/theme).
function scoreComponent(c: (typeof components)[number], ql: string): number {
  const name = c.name.toLowerCase();
  const pkg = (c.package ?? "").toLowerCase();
  const id = c.id.toLowerCase();
  const kws = (c.keywords ?? []).map((k) => k.toLowerCase());
  const desc = (c.description ?? "").toLowerCase();
  const owner = (c.owner ?? "").toLowerCase();
  let s = 0;
  // whole-query matches (strongest signal)
  if (pkg === ql || pkg === `@broberg/${ql}` || name === ql || id === ql) s += 100;
  else if (pkg.startsWith(ql) || name.startsWith(ql) || id.startsWith(ql)) s += 50;
  else if (pkg.includes(ql) || name.includes(ql) || id.includes(ql)) s += 25;
  if (kws.includes(ql)) s += 60; // the whole query IS one of the aliases
  else if (kws.some((k) => k.includes(ql))) s += 20;
  // per-token matches (so multi-word / natural-language queries resolve)
  for (const t of tokenize(ql)) {
    if (kws.includes(t)) s += 18;
    else if (kws.some((k) => k.includes(t))) s += 8;
    if (name.includes(t) || pkg.includes(t) || id.includes(t)) s += 12;
    if (desc.includes(t)) s += 3;
    if (owner.includes(t)) s += 2;
  }
  return s;
}
const rankComponents = (list: typeof components, ql: string) =>
  list.map((c) => ({ c, s: scoreComponent(c, ql) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c);
function scorePackage(p: (typeof packages)[number], ql: string): number {
  const name = (p.name ?? "").toLowerCase();
  const kws = (p.keywords ?? []).map((k) => k.toLowerCase());
  const desc = (p.description ?? "").toLowerCase();
  let s = 0;
  if (name === ql || name === `@broberg/${ql}`) s += 100;
  else if (name.includes(ql)) s += 40;
  if (kws.includes(ql)) s += 60;
  else if (kws.some((k) => k.includes(ql))) s += 20;
  for (const t of tokenize(ql)) {
    if (kws.includes(t)) s += 18;
    else if (kws.some((k) => k.includes(t))) s += 8;
    if (name.includes(t)) s += 12;
    if (desc.includes(t)) s += 3;
  }
  return s;
}
const rankPackages = (ql: string) =>
  packages.map((p) => ({ p, s: scorePackage(p, ql) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.p);

// Infra + fleet matcher. The whole query may match the FULL text (so a phrase like
// "cookie domain" still finds the relevant platform via its notes), but a single
// TOKEN only matches the CURATED fields (name/role/aliases) as a whole word — so a
// stray word from a phrase ("dark" in "dark mode") can't drag in an unrelated
// platform by substring-hitting its long-form notes (e.g. "ship-dark").
const platformMatch = (full: string, curated: string, ql: string): boolean => {
  if (full.toLowerCase().includes(ql)) return true;
  const words = new Set(curated.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return tokenize(ql).some((t) => words.has(t));
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
    "You are at the Discovery root. Every endpoint and every value you can filter by is listed below, so you can explore the whole inventory without knowing it in advance. Typical flow: GET /api/search?q=<what-you-need> → if nothing fits, you're clear to build (then tell components so it's added for everyone). Search is tokenized and alias-aware: a natural phrase OR a short keyword both work — 'send email' and 'mail' both find @broberg/mail, 'dark mode' finds @broberg/theme, 'postgres' finds Supabase. Each component also carries a `keywords` array of the aliases it answers to.",
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
    { method: "GET", path: "/api/enrollments", description: "live enrollment roster — who has adopted which package@version (F039 auto-enrollment)", example: "/api/enrollments" },
    { method: "GET", path: "/api/sessions/:session", description: "a session's enrollment status: enrolled + newest versions + the gap (shipped packages not yet adopted)", example: "/api/sessions/trail" },
    { method: "POST", path: "/api/enroll", description: "self-report an enrollment. Auth = trust-on-first-use: generate your OWN key (openssl rand -hex 32) into your repo's .env, send it as header x-enroll-key — the first enroll binds it to your session, later enrolls must match. Body {session,pkg,version,role?,commit?,notes?}", example: "/api/enroll" },
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
  if (q) out = rankComponents(out, q.toLowerCase());
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
  const out = q ? rankPackages(q.toLowerCase()) : packages;
  return c.json({ count: out.length, packages: out });
});

app.get("/api/infra", (c) => {
  const q = c.req.query("q");
  const list = infra.map(({ notes, tips, ...rest }) => rest); // summary list (no long notes/tips; keeps kw aliases)
  const out = q
    ? list.filter((p) => {
        const cur = `${p.name} ${p.role} ${(p.kw ?? []).join(" ")}`;
        return platformMatch(cur, cur, q.toLowerCase());
      })
    : list;
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
    components: rankComponents(components, ql),
    packages: rankPackages(ql),
    fleet: FLEET.filter((f) => platformMatch(`${f.s} ${f.r}`, `${f.s} ${f.r}`, ql)),
    infra: infra.filter((p) =>
      platformMatch(
        `${p.name} ${p.role} ${p.notes ?? ""} ${(p.tips ?? []).map((t) => t.t).join(" ")} ${(p.kw ?? []).join(" ")}`,
        `${p.name} ${p.role} ${(p.kw ?? []).join(" ")}`,
        ql,
      ),
    ),
  });
});

// ---- F039 auto-enrollment write-layer ----
// Live roster: who has adopted which package@version. Reads are public; the
// overlay sits beside the compiled FLEET roster (which stays canonical).
app.get("/api/enrollments", async (c) => {
  const store = await getEnrollStore();
  if (!store) return c.json({ count: 0, enrollments: [], configured: false });
  const list = await store.list();
  return c.json({ count: list.length, enrollments: list });
});

// A session's status: what it's enrolled in, the newest shipped versions, and
// the GAP (shipped packages it hasn't adopted yet — "what you could reuse").
app.get("/api/sessions/:session", async (c) => {
  const session = c.req.param("session");
  const store = await getEnrollStore();
  const enrolled = store ? await store.bySession(session) : [];
  const have = new Set(enrolled.map((e) => e.pkg));
  // A session never "needs to adopt" a package it OWNS — exclude its own
  // published packages (per the FLEET roster's pub list) from the gap, else a
  // package-owner is told it's missing itself (ai-sdk #5335).
  const owns = (FLEET.find((f) => f.s === session)?.pub ?? []).map((n: string) => `@broberg/${n}`);
  const owned = new Set(owns);
  const available = packages.map((p) => ({ package: p.name, version: p.version, layer: p.layer }));
  const gap = available.filter((a) => !have.has(a.package as string) && !owned.has(a.package as string));
  return c.json({ session, owns, enrolled, available, gap });
});

// Self-report an enrollment. Auth = trust-on-first-use per session: each session
// generates its OWN key (openssl rand -hex 32) and keeps it in its OWN .env — no
// central key to distribute, no human in the loop. The first enroll for a session
// binds sha256(key); later enrolls from that session must present the same key.
// Validates pkg against the known list so the roster can't be polluted. Idempotent
// on (session, pkg).
app.post("/api/enroll", async (c) => {
  const store = await getEnrollStore();
  if (!store) return c.json({ error: "enrollment_store_unavailable" }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const session = typeof body.session === "string" ? body.session : "";
  const pkg = typeof body.pkg === "string" ? body.pkg : "";
  const version = typeof body.version === "string" ? body.version : "";
  if (!session || !pkg || !version) return c.json({ error: "session, pkg and version are required" }, 400);
  if (!packageNames.has(pkg)) {
    return c.json({ error: `unknown package "${pkg}" — must be a published @broberg package`, packages: [...packageNames] }, 400);
  }

  // TOFU per-session key. Require a reasonably strong self-generated key.
  const presented = c.req.header("x-enroll-key") ?? "";
  if (presented.length < 32) {
    return c.json({ error: "x-enroll-key required (min 32 chars — generate your own: `openssl rand -hex 32`, keep it in your repo's .env)" }, 401);
  }
  const keyHash = createHash("sha256").update(presented).digest("hex");
  const bound = await store.sessionKeyHash(session);
  let keyStatus: "registered" | "matched";
  if (!bound) {
    await store.bindSessionKey(session, keyHash);
    keyStatus = "registered"; // first contact for this session — TOFU bind
  } else if (bound === keyHash) {
    keyStatus = "matched";
  } else {
    return c.json({ error: "session_key_mismatch — this session is already bound to a different key (use the one in your .env, or ask components to reset it)" }, 401);
  }

  const role: Role = body.role === "src" ? "src" : "uses";
  const enrollment = await store.upsert({
    session,
    pkg,
    version,
    role,
    commit: typeof body.commit === "string" ? body.commit : null,
    notes: typeof body.notes === "string" ? body.notes : null,
  });
  return c.json({ ok: true, key: keyStatus, enrollment });
});

export default { port: Number(process.env.PORT) || 3000, fetch: app.fetch };
export { app };

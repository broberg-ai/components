// Single source of truth for the @broberg component inventory.
// Imported by BOTH scripts/build-inventory.mjs (the dashboard HTML generator)
// and apps/discovery (the Discovery API at discovery.broberg.ai). Edit the
// inventory HERE — never duplicate the component list. (F038.1)

export const M = { runtime: "📦", copy: "📋", scaffold: "🏗️", hybrid: "🔀" };

export const MODEL = {
  runtime: "Runtime npm package — shared only when genuinely identical across ≥3 repos; installed and imported.",
  copy: "Copy-owned — copied into each app and free to diverge per brand.",
  scaffold: "Scaffold — a starting skeleton you stamp out, then own.",
  hybrid: "Hybrid — shared headless core plus a thin per-stack / per-brand adapter.",
};

export const EFFORT = { S: "S (small)", M: "M (medium)", L: "L (large)" };

export const DATA = [
 { n:"L0", t:"Rails", d:"foundation every app stands on", items:[
   {f:"F001",nm:"Design tokens + theme preset",pkg:"@broberg/theme",m:"hybrid",e:"M",i:"critical",s:"shipped",ver:"0.3.1",src:"webhouse/cms",own:"cms",desc:"The design-token foundation every surface inherits — light/dark across neutral/cool/warm theme variants as oklch CSS variables, a headless theme store with React and Preact adapters (no next-themes), plus a DESIGN.md to Tailwind-v4 generator with WCAG-AA contrast checking. Shipped to npm as @broberg/theme v0.2.0 — the keystone that unblocks every visual component below."},
   {f:"F002",nm:"Stack B base scaffold",pkg:"@broberg/stack-b-base",m:"scaffold",e:"M",i:"high",src:"broberg/cardmem",own:"cardmem",desc:"A ready-to-run base scaffold for Stack B apps (Bun · Hono · Preact · Tailwind v4) so a new lightweight service boots with the house wiring already in place."},
   {f:"F003",nm:"Stack A base scaffold",pkg:"@broberg/stack-a-base",m:"scaffold",e:"M",i:"high",src:"webhouse/boilerplates-cms",own:"boilerplates-cms",desc:"The Stack A counterpart — a Next.js 16 / React 19 / Tailwind v4 / shadcn base scaffold. The canonical variants are already maintained in boilerplates-cms; extraction into a create-* CLI is piloted there."},
   {f:"F004",nm:"Config single-source helper",pkg:"@broberg/config",m:"runtime",e:"S",i:"high",src:"broberg/xrt81",own:"xrt81",desc:"A single-source config helper — one typed place to read URLs, env and feature flags so values trickle down instead of being hardcoded in five files."},
   {f:"F005",nm:"Mail sending (Resend)",pkg:"@broberg/mail",m:"runtime",e:"S",i:"high",s:"shipped",ver:"0.1.0",src:"broberg-ai/components",own:"components",desc:"The fleet's thin Resend send primitive — the four-line 'lazy init → allow-guard → send → {ok,error}' chokepoint that sanne/xrt81/cms/upmetrics/trail all duplicated, lifted into one dependency-free package. createMailer / createMailerFromEnv (reads RESEND_API_KEY / MAIL_FROM / MAIL_ALLOWLIST … — works Node/Bun/edge); raw fetch to Resend's REST API (no SDK, no version-floor); ship-dark when no key (logged no-op, never crashes a flow); an allowlist gate with ALWAYS_ALLOWED fleet admins so test/preview sends never reach real users (the mail mirror of lens's never-cb guard); typed {ok,id?,error?,skipped?} that never throws; passes through text/replyTo/cc/bcc/headers/tags/attachments. Delivery only — HTML templates stay per-brand (F023). Shipped as @broberg/mail v0.1.0 — epic F005."},
   {f:"F006",nm:"Media / Cloudflare R2",pkg:"@broberg/media-r2",m:"runtime",e:"M",i:"high",src:"broberg/cardmem",own:"cardmem",desc:"Object storage on Cloudflare R2 — upload, signed-URL and delete primitives for media, as a framework-agnostic runtime core."},
   {f:"F007",nm:"MCP Server Toolkit",pkg:"@broberg/mcp",m:"hybrid",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"A toolkit for building MCP servers (the protocol every fleet tool speaks) — shared scaffolding and helpers so a new MCP server is mostly glue."},
   {f:"F035",nm:"Secret / credential redaction",pkg:"@broberg/secret-scan",m:"runtime",e:"S",i:"high",s:"shipped",ver:"0.1.3",src:"broberg/trail",own:"cms",desc:"Pure, dependency-free secret/credential redaction — redactSecrets / hasSecret over a curated, ordered pattern set so an API key never lands in a database, a chat answer, or a shared knowledge base. Components-owned, lifted from trail F197; the canonical fleet pattern list. Shipped to npm as @broberg/secret-scan v0.1.3."},
   {f:"F036",nm:"Lens-mint compliance",pkg:"@broberg/lens",m:"hybrid",e:"M",i:"high",s:"shipped",ver:"0.1.2",src:"broberg/cardmem",own:"cms",desc:"A headless POST /api/lens-session mint endpoint (+ thin Next.js / Hono adapters) that issues a short-lived, read-only Playwright session so Cardmem Lens can log past the auth wall and screenshot the real authed surface — incl. production. Components-owned; implements cardmem's F098.1 standard. Shipped as @broberg/lens v0.1.1 and proven in cardmem's live prod."},
 ]},
 { n:"L1", t:"Identity", d:"who the user is", items:[
   {f:"F008",nm:"OAuth login providers",pkg:"@broberg/oauth",m:"runtime",e:"M",i:"high",src:"broberg/xrt81",own:"xrt81",desc:"OAuth login providers — Google, Apple and GitHub sign-in plus identity-linking, as a runtime package."},
   {f:"F009",nm:"User management + invitation",m:"hybrid",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"User management and invitation flows — roles, invites and member lists. Shared core, per-brand UI."},
   {f:"F010",nm:"API-key + rate-limit",pkg:"@broberg/apikey",m:"runtime",e:"M",i:"high",src:"broberg/trail",own:"trail",desc:"API-key issuance and rate-limiting — mint, store and throttle keys for programmatic access."},
   {f:"F011",nm:"Event / activity log (GDPR)",m:"hybrid",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"A GDPR-aware event and activity log — an append-only audit trail of who-did-what."},
   {f:"F012",nm:"Profile + image upload",m:"hybrid",e:"M",i:"medium",src:"broberg/xrt81",own:"xrt81",desc:"Profile editing and image upload — avatar crop/upload and the basic profile fields."},
   {f:"F013",nm:"Gravatar connector",pkg:"@broberg/gravatar",m:"runtime",e:"S",i:"medium",src:"webhouse/fysiodk-aalborg-sport",own:"fysiodk-aalborg-sport",desc:"A Gravatar connector — resolve an email to its Gravatar avatar with sensible fallbacks."},
   {f:"F014",nm:"Consent / cookie banner",m:"copy",e:"M",i:"medium",src:"cbroberg/codepromptmaker",own:"codepromptmaker",desc:"A consent and cookie banner — GDPR consent capture, styled per brand."},
 ]},
 { n:"L2", t:"Shell", d:"the app frame & controls", items:[
   {f:"F015",nm:"Mode-switch (dark/light/system)",m:"hybrid",e:"S",i:"high",src:"webhouse/fysiodk-aalborg-sport",own:"fysiodk-aalborg-sport",desc:"The dark / light / system mode-switch — the control plus the persistence wiring, built on F001's tokens."},
   {f:"F016",nm:"Toasts / Modals / Custom controls",m:"copy",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"The custom-control kit — toasts, modals and the native-replacement controls house-style requires (CustomSelect, DatePicker, ConfirmModal)."},
   {f:"F017",nm:"Settings — tabbed config shell",m:"hybrid",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"A tabbed settings shell — section panels and nav for any app's configuration screen."},
   {f:"F018",nm:"Command palette (Cmd+K)",m:"copy",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"A Cmd+K command palette — fuzzy action search and quick-nav overlay."},
   {f:"F019",nm:"i18n / language switch",m:"hybrid",e:"M",i:"medium",src:"broberg/trail",own:"trail",desc:"i18n and a language switch — message catalogs plus the in-app locale toggle."},
   {f:"F020",nm:"SEO / metadata helpers",pkg:"@broberg/seo",m:"runtime",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"SEO and metadata helpers for Stack A — typed Open-Graph and metadata builders for Next.js."},
   {f:"F021",nm:"PWA setup",m:"hybrid",e:"M",i:"medium",src:"broberg/xrt81",own:"xrt81",desc:"PWA setup — manifest, service-worker and install wiring so an app becomes installable."},
   {f:"F022",nm:"PWA update banner",m:"copy",e:"M",i:"medium",src:"broberg/cardmem",own:"cardmem",desc:"A PWA update banner — the custom toast that tells a user a new version is ready (never a native dialog)."},
   {f:"F034",nm:"User menu (account dropdown)",m:"copy",e:"M",i:"high",src:"webhouse/cms + broberg/xrt81",own:"cms + xrt81",desc:"The account dropdown in the top bar — a composition of profile (F012/13), mode-switch (F015), language (F019), controls (F016) and auth (F008/09)."},
 ]},
 { n:"L3", t:"Domain", d:"feature surfaces", items:[
   {f:"F023",nm:"Mail templates",m:"copy",e:"M",i:"high",src:"webhouse/sanneandersen",own:"sanneandersen",desc:"Reusable mail templates — the branded HTML layouts F005 sends. Diverges per brand."},
   {f:"F024",nm:"Forms + Turnstile",m:"hybrid",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"A spam-protected form pipeline — forms wired to Cloudflare Turnstile plus server validation."},
   {f:"F025",nm:"Chat / chatbot UI",m:"hybrid",e:"L",i:"high",src:"webhouse/cms",own:"cms",desc:"A chat / chatbot UI — message list, streaming and input affordances for an assistant surface."},
   {f:"seti-client",nm:"SETI streaming chat (client + Preact UI)",pkg:"@broberg/seti-client",m:"hybrid",e:"M",i:"high",s:"shipped",ver:"0.2.1",src:"broberg-ai/components",own:"components",desc:"The SETI streaming-chat client — a framework-agnostic core (FrameAccumulator scrollback engine + SetiClient: list / stream / sendText / sendKey over buddycloud's SETI API) plus a mobile-first Preact <SetiChat> component (status header, accumulated screen, nav-keys bar, delivery-feedback input; data-testid on every control). Lets any host app embed live cc-session streaming chat. The /input timeout is configurable (inputTimeoutMs, 30s default) so a busy/slow edge doesn't surface a false 'not sent'. Shipped as @broberg/seti-client v0.1.2 — epic F037 (contract = buddy F071.10; first consumer = cardmem's PLAN→Chat)."},
   {f:"seti-server",nm:"SETI proxy router",pkg:"@broberg/seti-server",m:"runtime",e:"S",i:"high",s:"shipped",ver:"0.2.2",src:"broberg-ai/components",own:"components",desc:"The SETI proxy router — a mountable Hono router (createSetiProxy) the host app mounts behind its OWN auth (app.route('/api/seti', …)). Pass-through to buddycloud's SETI API (GET /sessions, SSE /stream, POST /input) plus the full LSD dashboard surface (view/search/info/markers/flags/fires/notifications, rules CRUD + nudge/pause/escalate action, decision-card answer, artifacts, turn-edit, command, SSE lsd/stream); the consumer token stays server-side, so same-origin ⇒ no CORS and EventSource works with the host's cookie auth. Shipped as @broberg/seti-server v0.1.0 — epic F037."},
   {f:"F026",nm:"SoundKit (browser audio)",pkg:"@broberg/soundkit",m:"runtime",e:"M",i:"medium",src:"cbroberg/catan-multi-player",own:"buddy",desc:"SoundKit — synthesized and file-based audio effects for browser apps (clicks, alerts, game SFX)."},
   {f:"F033",nm:"Deploy provider core + trigger UI",pkg:"@broberg/deploy-core",m:"hybrid",e:"L",i:"high",src:"webhouse/cms",own:"cms",desc:"The execution half of the former F027 — a deploy-provider core plus trigger UI (@broberg/deploy-core) that actually kicks off deploys."},
   {f:"F027",nm:"Deployment Mgmt (observe)",m:"hybrid",s:"moved",note:"→ Upmetrics F019",src:"webhouse/cms",own:"upmetrics",desc:"The observe half of deployment management — probe / health / CI-watch and a deploy-event timeline correlated with the error stream. Re-homed to Upmetrics (F019), where the telemetry domain lives — this card is moved, not built here."},
   {f:"F028",nm:"Podcast manager / maker",m:"scaffold",e:"L",i:"medium",grad:1,src:"webhouse/cms",own:"cms",desc:"A podcast manager / maker — collection templates, an RSS generator, an admin page and an AI PodcastAgent. A graduate candidate; canonical design is cms F05."},
 ]},
 { n:"L4", t:"Capstone", d:"whole-product builders", items:[
   {f:"F029",nm:"Multi-tenant management",m:"hybrid",e:"L",i:"high",grad:1,src:"webhouse/cms",own:"cms",desc:"Multi-tenant management — org / workspace isolation plus member and billing seams. A large graduate-candidate capstone."},
   {f:"F030",nm:"Native mobile boilerplate",m:"hybrid",e:"L",i:"high",grad:1,src:"webhouse/cms",own:"cms",desc:"A native mobile boilerplate (Capacitor) — wrap a web app as iOS/Android with the house wiring."},
   {f:"F031",nm:"Greenfield scaffolder",m:"scaffold",e:"M",i:"high",src:"broberg/cardmem",own:"cardmem",desc:"The greenfield scaffolder — chooses plain-npm versus a pnpm+Turbo monorepo and stamps out a new project."},
   {f:"F032",nm:"create-app CLI + manifest",m:"scaffold",e:"L",i:"high",grad:1,src:"webhouse/cms",own:"cms",desc:"create-app CLI plus a machine-readable manifest — the AI product-builder that turns a spec into a running app skeleton."},
 ]},
 { n:"SDK", t:"Fleet SDKs", d:"sibling @broberg packages — installed here, owned + shipped in their own repos", items:[
   {f:"db-sdk",nm:"Data SDK",pkg:"@broberg/db-sdk",m:"runtime",s:"shipped",ver:"0.1.0",ext:1,src:"own repo",own:"db-sdk repo",desc:"The fleet Data SDK — typed database-access primitives shared across apps. Owned in its own repo and installed here, not built in components. Live on npm as @broberg/db-sdk v0.1.0."},
   {f:"ai-sdk",nm:"AI / LLM SDK",pkg:"@broberg/ai-sdk",m:"runtime",s:"shipped",ver:"0.12.0",ext:1,src:"@webhouse/ai",own:"ai-sdk repo",desc:"The fleet LLM SDK — a thin, config-driven wrapper over the Vercel AI SDK so every app talks to models the same way. Now ships the F022 Model Availability Harness — a synchronous in-memory registry (resolveModel + listModels, zero hot-path I/O) so a disappeared model (e.g. Fable 5, globally suspended 2026-06-12 by US export-control) is grey-out/fallback-handled before it ever reaches a user; the browser-safe /registry subpath exports listModels without bundling native deps. Owned by @webhouse/ai. Live as @broberg/ai-sdk v0.12.0."},
   {f:"upmetrics-sdk",nm:"Telemetry SDK",pkg:"@upmetrics/sdk",m:"runtime",s:"shipped",ver:"0.2.0",ext:1,src:"broberg/upmetrics",own:"upmetrics",desc:"The fleet telemetry SDK — cost, error and metric reporting from any app. Owned by the upmetrics repo. Live as @upmetrics/sdk v0.2.0."},
   {f:"upmetrics-swift",nm:"Telemetry SDK (Swift)",pkg:"upmetrics-swift",m:"runtime",s:"shipped",ver:"0.1.0",ext:1,dist:"spm",src:"broberg-ai/upmetrics-swift",own:"upmetrics",desc:"Native iOS/macOS error + crash reporting — the Swift sibling of @upmetrics/sdk (same Sentry-envelope contract, public DSN only, async-signal-safe crash capture). Distributed via SwiftPM (git URL), NOT npm: .package(url: \"https://github.com/broberg-ai/upmetrics-swift\", from: \"0.1.0\") → product \"Upmetrics\". First consumers: buddy mobile, notesmem. When a new Swift app needs crash reporting → reuse this, don't build new."},
   {f:"fleet-client",nm:"Fleet client",pkg:"@broberg/fleet-client",m:"runtime",s:"shipped",ver:"0.1.0",ext:1,src:"broberg-ai/fleet",own:"fleet (buddy F072)",desc:"The typed fleet-comms client — intercom dispatch, terminal provision, notify-mobile, board digest — validated against fleet-contracts before send. Owned by broberg-ai/fleet. Live as @broberg/fleet-client v0.1.0."},
   {f:"fleet-contracts",nm:"Fleet contracts",pkg:"@broberg/fleet-contracts",m:"runtime",s:"shipped",ver:"0.1.0",ext:1,src:"broberg-ai/fleet",own:"fleet (buddy F072)",desc:"The fleet-comms contracts — zod schemas + FLEET_ENDPOINTS (the single source of truth) that fleet-client validates against. Owned by broberg-ai/fleet. Live as @broberg/fleet-contracts v0.1.0."},
 ]},
];

// The fleet roster — who builds & consumes the shared library (F038/inventory Fleet section).
export const FLEET = [
  { s:"components", r:"the shared-library home — this repo", pub:["theme","secret-scan","lens","seti-client","seti-server","mail"] },
  { s:"buddy", r:"fleet daemon — cron, intercom, SETI cloud", pub:["fleet-client","fleet-contracts"] },
  { s:"ai-sdk", r:"the fleet LLM SDK", pub:["ai-sdk"] },
  { s:"upmetrics", r:"telemetry, errors & deploy timeline", pub:["@upmetrics/sdk","upmetrics-swift"] },
  { s:"cardmem", r:"PM board + Lens visual-verification daemon", src:["lens"], uses:["lens","seti-client","seti-server"] },
  { s:"trail", r:"trailmem — fleet second-brain", src:["secret-scan"], uses:["lens","secret-scan","mail"] },
  { s:"sanne", r:"sanneandersen.dk — booking + shop", src:["mail"], uses:["lens","mail"] },
  { s:"cms", r:"AI-native CMS", src:["theme"] },
  { s:"xrt81", r:"X RT 81 — club platform", src:["config"], uses:["lens"] },
  { s:"fds", r:"sport.fdaalborg.dk", uses:["lens"], note:"mail via AWS SES (not @broberg/mail)" },
  { s:"fdaa", r:"fdaalborg.dk — fysio platform", uses:["mail"], isNew:true },
];

// Infra best-practices — the platforms we primarily run on, with live, crowd-sourced
// tips & gotchas from across the fleet (F038). Seed tips are grounded in the fleet
// rules + hard-won lessons; `by` credits the contributing session. New tips fold in
// as sessions reply to the infra sweep. Each platform's `notes` is the long-form
// text shown when its card is clicked. (tip: { t, by, tag? })
export const INFRA = [
  {
    id: "fly", name: "Fly.io", role: "App hosting + deploy — most fleet services run here",
    region: "Always arn (Stockholm) — never US/Amsterdam",
    notes: "Fly.io is where most broberg.ai services run. The fleet rule is region arn (Stockholm) for every app — latency + data-residency consistency. Keep small services idle-cheap with autostop/autostart and min_machines_running=0; they cold-start in ~1s on the next request. Deploy with --remote-only so you don't need local Docker. Secrets live in flyctl secrets set (never in the image, never committed). Custom domains: fly certs add <domain>, then point DNS at the app (CNAME to <app>.fly.dev) — the Let's Encrypt cert validates automatically once DNS resolves.",
    tips: [
      { t: "Region is ALWAYS arn (Stockholm). Set primary_region = \"arn\" — never US/Amsterdam.", by: "components", tag: "region" },
      { t: "Idle-cheap services: auto_stop_machines = \"stop\" + auto_start_machines = true + min_machines_running = 0. Cold-start ~1s.", by: "components", tag: "cost" },
      { t: "fly deploy --remote-only builds on Fly's builder — no local Docker daemon needed.", by: "components", tag: "deploy" },
      { t: "Secrets via flyctl secrets set KEY=val (encrypted, injected at runtime). Never bake into the image or commit.", by: "components", tag: "secrets" },
      { t: "Custom domain: fly certs add <domain> first; the cert validates by itself once the DNS record resolves.", by: "components", tag: "tls" },
      { t: "Debug live: fly logs -a <app>, fly ssh console -a <app>, fly status. Health check on /health in [[http_service.checks]].", by: "components", tag: "ops" },
    ],
  },
  {
    id: "cloudflare", name: "Cloudflare", role: "DNS, CDN, Turnstile, R2 — the rest of the stack",
    region: "Global edge",
    notes: "Cloudflare hosts DNS for several fleet zones (e.g. broberg.ai), plus Turnstile (bot protection on forms), R2 (object storage — see @broberg/media-r2) and CDN. The single biggest gotcha: when a subdomain CNAMEs to a Fly app, keep the record DNS-only (grey cloud) — an orange/proxied record makes Cloudflare's proxy fight Fly's Let's Encrypt validation and HTTPS breaks. For Turnstile, serve the site-key from a runtime endpoint so keys rotate without a rebuild; keys are domain-scoped (one Turnstile site per project).",
    tips: [
      { t: "CNAME → a Fly app MUST be DNS-only (grey cloud), not proxied (orange) — else Fly's TLS cert validation fails.", by: "components", tag: "dns" },
      { t: "Turnstile site-key from a runtime config endpoint (not a build-time env) → rotate keys without rebuild/redeploy.", by: "xrt81", tag: "turnstile" },
      { t: "Turnstile sites are domain-scoped — each project needs its own site (keys aren't reusable across domains).", by: "xrt81", tag: "turnstile" },
      { t: "Object storage = R2; consume via @broberg/media-r2 rather than rolling raw S3 calls.", by: "components", tag: "storage" },
    ],
  },
  {
    id: "resend", name: "Resend", role: "Transactional email (booking, magic-links, notifications)",
    region: "—",
    notes: "Resend is the fleet's transactional-email provider. Don't roll your own client — consume @broberg/mail (the shared send primitive: ship-dark without a key, recipient allowlist so test/preview mail never hits real users, typed {ok,id,error} that never throws). Only send From a verified domain (check the Resend dashboard → Domains). Templates stay per-brand (F023); the package owns delivery only. Raw REST works on edge (no SDK needed).",
    tips: [
      { t: "Use @broberg/mail — don't hand-roll a Resend client. createMailer({apiKey, from, allowlist}) keeps your own env-var names.", by: "components", tag: "reuse" },
      { t: "Send only From a VERIFIED domain (Resend → Domains). An unverified From fails or tanks deliverability.", by: "components", tag: "domains" },
      { t: "Dev/preview: keep MAIL_LIVE off + an allowlist so test mail never reaches real users (fleet admins always pass).", by: "components", tag: "safety" },
      { t: "resend.batch.send strips attachments — send per-recipient when you embed inline cid: images.", by: "sanne", tag: "gotcha" },
      { t: "Wire the Resend webhook (Svix-signed) for delivered/opened/bounced/complained events.", by: "sanne", tag: "webhooks" },
    ],
  },
  {
    id: "supabase", name: "Supabase", role: "Postgres + auth (sanne, xrt81, fds, fdaa)",
    region: "Always arn (Stockholm)",
    notes: "Supabase (Postgres + auth) backs several consumer apps. Provision in region arn. For Cardmem Lens to screenshot authed surfaces, mint a short-lived read-only session via @broberg/lens (keep ONLY your Supabase-specific signInWithPassword in createSession; the package owns bearer/ship-dark/TTL/cookie-domain). Watch the cookie-domain-behind-proxy trap: deriving cookie domain from the Host header yields 'localhost' behind Apache/Fly proxies, so the browser never sends the cookie to the real domain — pin LENS_COOKIE_DOMAIN. Keep the service-role key server-side only.",
    tips: [
      { t: "Provision in region arn (Stockholm) — same as Fly.", by: "components", tag: "region" },
      { t: "Authed Lens capture → @broberg/lens; keep only your signInWithPassword in createSession, package owns the rest.", by: "components", tag: "lens" },
      { t: "Cookie-domain trap: behind a proxy the Host header is 'localhost' → cookie never reaches the real domain. Pin LENS_COOKIE_DOMAIN.", by: "fds", tag: "gotcha" },
      { t: "service_role key is server-side ONLY — never ship it to the browser. Use a read-only/anon key client-side.", by: "components", tag: "security" },
    ],
  },
  {
    id: "turso", name: "Turso / libSQL", role: "Edge SQLite — the @broberg/db-sdk backend",
    region: "Primary arn + embedded replicas",
    notes: "Turso (libSQL) is the fleet's edge-SQLite option, consumed through @broberg/db-sdk (the thin libSQL transport — don't bespoke a connector). Primary in arn; use embedded replicas for low-latency multi-region reads. Good fit for state that outgrows a per-machine Fly volume but doesn't need full Postgres.",
    tips: [
      { t: "Consume via @broberg/db-sdk (libSQL transport) rather than a bespoke client.", by: "components", tag: "reuse" },
      { t: "Primary DB in arn; add embedded replicas for fast multi-region reads.", by: "components", tag: "region" },
      { t: "Right tool when state outgrows a per-machine Fly volume but doesn't need full Postgres.", by: "components", tag: "fit" },
    ],
  },
];

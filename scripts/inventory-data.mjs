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
   {f:"F001",nm:"Design tokens + theme preset",pkg:"@broberg/theme",kw:["theme","design tokens","design system","dark mode","light mode","colors","color palette","css variables","tailwind","oklch","theming","brand"],m:"hybrid",e:"M",i:"critical",s:"shipped",ver:"0.3.1",src:"webhouse/cms",own:"cms",desc:"The design-token foundation every surface inherits — light/dark across neutral/cool/warm theme variants as oklch CSS variables, a headless theme store with React and Preact adapters (no next-themes), plus a DESIGN.md to Tailwind-v4 generator with WCAG-AA contrast checking. Shipped to npm as @broberg/theme v0.2.0 — the keystone that unblocks every visual component below."},
   {f:"F002",nm:"Stack B base scaffold",pkg:"@broberg/stack-b-base",m:"scaffold",e:"M",i:"high",src:"broberg/cardmem",own:"cardmem",desc:"A ready-to-run base scaffold for Stack B apps (Bun · Hono · Preact · Tailwind v4) so a new lightweight service boots with the house wiring already in place."},
   {f:"F003",nm:"Stack A base scaffold",pkg:"@broberg/stack-a-base",m:"scaffold",e:"M",i:"high",src:"webhouse/boilerplates-cms",own:"boilerplates-cms",desc:"The Stack A counterpart — a Next.js 16 / React 19 / Tailwind v4 / shadcn base scaffold. The canonical variants are already maintained in boilerplates-cms; extraction into a create-* CLI is piloted there."},
   {f:"F004",nm:"Config single-source helper",pkg:"@broberg/config",kw:["config","env","environment","dotenv","env vars","feature flags","settings","zod config","single source","validate env"],m:"runtime",e:"S",i:"high",s:"shipped",ver:"0.1.1",src:"broberg-ai/components",own:"components",desc:"The fleet's single-source config helper — enforces 'one source, trickle down' (Christian's no-hardcoded-values rule) as a reusable mechanism. parseEnv(schema, source?) validates + types process.env at boot via a Zod schema, failing fast with every offending key listed; defineConfig(obj) brands a typed business-constant object (fee tiers, magic numbers) as one import boundary; coerceInt/coerceBool are the no-Zod escape hatch (throw loudly on a malformed value, fall back when absent); productionGuard(config, keys) crashes the boot if a required secret is falsy in production. Zero runtime deps (zod is a peer); runs in Node/Bun/edge. Reference impl lifted from xrt81's env.ts + upmetrics' guard. Shipped as @broberg/config v0.1.1 (OIDC) — epic F004."},
   {f:"F005",nm:"Mail sending (Resend)",pkg:"@broberg/mail",kw:["mail","email","e-mail","send email","sending email","send mail","smtp","resend","transactional email","magic link email","notification email","newsletter"],m:"runtime",e:"S",i:"high",s:"shipped",ver:"0.1.0",src:"broberg-ai/components",own:"components",desc:"The fleet's thin Resend send primitive — the four-line 'lazy init → allow-guard → send → {ok,error}' chokepoint that sanne/xrt81/cms/upmetrics/trail all duplicated, lifted into one dependency-free package. createMailer / createMailerFromEnv (reads RESEND_API_KEY / MAIL_FROM / MAIL_ALLOWLIST … — works Node/Bun/edge); raw fetch to Resend's REST API (no SDK, no version-floor); ship-dark when no key (logged no-op, never crashes a flow); an allowlist gate with ALWAYS_ALLOWED fleet admins so test/preview sends never reach real users (the mail mirror of lens's never-cb guard); typed {ok,id?,error?,skipped?} that never throws; passes through text/replyTo/cc/bcc/headers/tags/attachments. Delivery only — HTML templates stay per-brand (F023). Shipped as @broberg/mail v0.1.0 — epic F005."},
   {f:"F006",nm:"Media storage (provider-agnostic)",pkg:"@broberg/media",kw:["storage","object storage","file storage","r2","s3","upload","file upload","media upload","blob","bucket","assets","signed url","presigned"],m:"runtime",e:"M",i:"high",s:"shipped",ver:"0.1.0",src:"broberg-ai/components",own:"components",desc:"The fleet's provider-agnostic media-storage facade — one createMedia() API (upload · signedUrl · delete) over swappable storage providers (the @broberg/ai-sdk model, for object storage), so a later backend swap never touches a call-site. Ships with a Cloudflare R2 provider (S3-compatible, SigV4 via aws4fetch — Node/Bun/edge, no AWS SDK), multi-tenant keyPrefix + EU-jurisdiction support, presigned GET URLs, and idempotent delete. Start on R2; S3/Supabase/GCS slot in behind the same config. Consumes an existing bucket+creds (provision via dns-mcp's R2Client / MCP tools). Reference impls: cardmem (multi-tenant R2) + sanneandersen. Shipped as @broberg/media v0.1.0 — epic F006."},
   {f:"F007",nm:"MCP Server Toolkit",pkg:"@broberg/mcp",m:"hybrid",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"A toolkit for building MCP servers (the protocol every fleet tool speaks) — shared scaffolding and helpers so a new MCP server is mostly glue."},
   {f:"F035",nm:"Secret / credential redaction",pkg:"@broberg/secret-scan",kw:["secret","secrets","redact","redaction","scrub","mask","credential","api key leak","pii","sanitize","sensitive data","secret scanning","github pat","fine-grained pat","github_pat"],m:"runtime",e:"S",i:"high",s:"shipped",ver:"0.1.5",src:"broberg/trail",own:"cms",desc:"Pure, dependency-free secret/credential redaction — redactSecrets / hasSecret over a curated, ordered pattern set so an API key never lands in a database, a chat answer, or a shared knowledge base. Components-owned, lifted from trail F197; the canonical fleet pattern list. Shipped to npm as @broberg/secret-scan v0.1.3."},
   {f:"F036",nm:"Lens-mint compliance",pkg:"@broberg/lens",kw:["lens","auth session","session mint","login session","playwright","screenshot","visual regression","e2e","authed capture","headless browser","behind auth","auth wall"],m:"hybrid",e:"M",i:"high",s:"shipped",ver:"0.1.2",src:"broberg/cardmem",own:"cms",desc:"A headless POST /api/lens-session mint endpoint (+ thin Next.js / Hono adapters) that issues a short-lived, read-only Playwright session so Cardmem Lens can log past the auth wall and screenshot the real authed surface — incl. production. Components-owned; implements cardmem's F098.1 standard. Shipped as @broberg/lens v0.1.1 and proven in cardmem's live prod."},
 ]},
 { n:"L1", t:"Identity", d:"who the user is", items:[
   {f:"F008",nm:"OAuth login providers",pkg:"@broberg/oauth",kw:["oauth","login","sign in","signin","sso","google login","apple login","github login","social login","authentication","auth"],m:"runtime",e:"M",i:"high",src:"broberg/xrt81",own:"xrt81",desc:"OAuth login providers — Google, Apple and GitHub sign-in plus identity-linking, as a runtime package."},
   {f:"F009",nm:"User management + invitation",m:"hybrid",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"User management and invitation flows — roles, invites and member lists. Shared core, per-brand UI."},
   {f:"F010",nm:"API-key + rate-limit",pkg:"@broberg/apikey",kw:["api key","apikey","rate limit","rate limiting","throttle","quota","access token","programmatic access","authorization","rbac","scopes","permissions","cidr","tenant","multi-tenant","bearer","token","timing-safe"],m:"runtime",e:"M",i:"high",s:"shipped",ver:"0.1.1",src:"broberg-ai/components",own:"components",desc:"The fleet's inbound API-key primitives — mint prefixed keys (generateKey), timing-safe verify (hashed-at-rest OR plaintext-revealable), a sliding-window rate-limiter over a PLUGGABLE store (in-memory default; shared Turso/Redis opt-in for stateless multi-machine), a Cloudflare-style authorization cascade (permission × resource-filter × CIDR × TTL, IPv4+IPv6, modelled on cms F134) and a membership-validated tenant selector (trail's selector-not-grant: a non-member slug is a hard 401, never a silent home-fallback). Owns the primitives, NEVER your storage/tenancy/rate-backend — bring your own lookup(). Core + /authorize + /hono + /next adapters (Web-standard, edge-safe). Scoped from a 9-repo fleet Q&R: pilots trail + cardmem + cms; upmetrics/vn covered by core. Shipped as @broberg/apikey v0.1.1 (v0.1.1 adds a per-check rate-limit max override) — epic F010."},
   {f:"F011",nm:"Event / activity log (GDPR)",m:"hybrid",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"A GDPR-aware event and activity log — an append-only audit trail of who-did-what."},
   {f:"F012",nm:"Profile + image upload",m:"hybrid",e:"M",i:"medium",src:"broberg/xrt81",own:"xrt81",desc:"Profile editing and image upload — avatar crop/upload and the basic profile fields."},
   {f:"F013",nm:"Gravatar connector",pkg:"@broberg/gravatar",m:"runtime",e:"S",i:"medium",src:"webhouse/fysiodk-aalborg-sport",own:"fysiodk-aalborg-sport",desc:"A Gravatar connector — resolve an email to its Gravatar avatar with sensible fallbacks."},
   {f:"F014",nm:"Consent / cookie banner",m:"copy",e:"M",i:"medium",src:"cbroberg/codepromptmaker",own:"codepromptmaker",desc:"A consent and cookie banner — GDPR consent capture, styled per brand."},
 ]},
 { n:"L2", t:"Shell", d:"the app frame & controls", items:[
   {f:"F015",nm:"Mode-switch (dark/light/system)",m:"hybrid",e:"S",i:"high",src:"webhouse/fysiodk-aalborg-sport",own:"fysiodk-aalborg-sport",desc:"The dark / light / system mode-switch — the control plus the persistence wiring, built on F001's tokens."},
   {f:"F016",nm:"Toasts / Modals / Custom controls",kw:["toast","toasts","modal","dialog","confirm dialog","custom select","dropdown","date picker","notification","snackbar","alert","popup"],m:"copy",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"The custom-control kit — toasts, modals and the native-replacement controls house-style requires (CustomSelect, DatePicker, ConfirmModal)."},
   {f:"F017",nm:"Settings — tabbed config shell",m:"hybrid",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"A tabbed settings shell — section panels and nav for any app's configuration screen."},
   {f:"F018",nm:"Command palette (Cmd+K)",m:"copy",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"A Cmd+K command palette — fuzzy action search and quick-nav overlay."},
   {f:"F019",nm:"i18n / language switch",m:"hybrid",e:"M",i:"medium",src:"broberg/trail",own:"trail",desc:"i18n and a language switch — message catalogs plus the in-app locale toggle."},
   {f:"F020",nm:"SEO / metadata helpers",pkg:"@broberg/seo",kw:["seo","metadata","meta tags","open graph","og tags","sitemap","social preview","search engine"],m:"runtime",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"SEO and metadata helpers for Stack A — typed Open-Graph and metadata builders for Next.js."},
   {f:"F021",nm:"PWA setup",m:"hybrid",e:"M",i:"medium",src:"broberg/xrt81",own:"xrt81",desc:"PWA setup — manifest, service-worker and install wiring so an app becomes installable."},
   {f:"F022",nm:"PWA update banner",m:"copy",e:"M",i:"medium",src:"broberg/cardmem",own:"cardmem",desc:"A PWA update banner — the custom toast that tells a user a new version is ready (never a native dialog)."},
   {f:"F034",nm:"User menu (account dropdown)",m:"copy",e:"M",i:"high",src:"webhouse/cms + broberg/xrt81",own:"cms + xrt81",desc:"The account dropdown in the top bar — a composition of profile (F012/13), mode-switch (F015), language (F019), controls (F016) and auth (F008/09)."},
 ]},
 { n:"L3", t:"Domain", d:"feature surfaces", items:[
   {f:"F023",nm:"Mail templates",m:"copy",e:"M",i:"high",src:"webhouse/sanneandersen",own:"sanneandersen",desc:"Reusable mail templates — the branded HTML layouts F005 sends. Diverges per brand."},
   {f:"F024",nm:"Forms + Turnstile",kw:["form","forms","contact form","turnstile","captcha","recaptcha","spam protection","bot protection","form validation"],m:"hybrid",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"A spam-protected form pipeline — forms wired to Cloudflare Turnstile plus server validation."},
   {f:"F025",nm:"Chat / chatbot UI",kw:["chat","chatbot","assistant ui","chat ui","message list","conversation ui","streaming chat ui","ai chat"],m:"hybrid",e:"L",i:"high",src:"webhouse/cms",own:"cms",desc:"A chat / chatbot UI — message list, streaming and input affordances for an assistant surface."},
   {f:"seti-client",nm:"SETI streaming chat (client + Preact UI)",pkg:"@broberg/seti-client",kw:["seti","streaming chat","live chat","chat client","session chat","sse chat","cc chat","embed chat"],m:"hybrid",e:"M",i:"high",s:"shipped",ver:"0.2.1",src:"broberg-ai/components",own:"components",desc:"The SETI streaming-chat client — a framework-agnostic core (FrameAccumulator scrollback engine + SetiClient: list / stream / sendText / sendKey over buddycloud's SETI API) plus a mobile-first Preact <SetiChat> component (status header, accumulated screen, nav-keys bar, delivery-feedback input; data-testid on every control). Lets any host app embed live cc-session streaming chat. The /input timeout is configurable (inputTimeoutMs, 30s default) so a busy/slow edge doesn't surface a false 'not sent'. Shipped as @broberg/seti-client v0.1.2 — epic F037 (contract = buddy F071.10; first consumer = cardmem's PLAN→Chat)."},
   {f:"seti-server",nm:"SETI proxy router",pkg:"@broberg/seti-server",kw:["seti","chat proxy","streaming proxy","sse proxy","lsd","hono router","live stream dialog","seti backend"],m:"runtime",e:"S",i:"high",s:"shipped",ver:"0.2.2",src:"broberg-ai/components",own:"components",desc:"The SETI proxy router — a mountable Hono router (createSetiProxy) the host app mounts behind its OWN auth (app.route('/api/seti', …)). Pass-through to buddycloud's SETI API (GET /sessions, SSE /stream, POST /input) plus the full LSD dashboard surface (view/search/info/markers/flags/fires/notifications, rules CRUD + nudge/pause/escalate action, decision-card answer, artifacts, turn-edit, command, SSE lsd/stream); the consumer token stays server-side, so same-origin ⇒ no CORS and EventSource works with the host's cookie auth. Shipped as @broberg/seti-server v0.1.0 — epic F037."},
   {f:"F026",nm:"SoundKit (browser audio)",pkg:"@broberg/soundkit",m:"runtime",e:"M",i:"medium",src:"cbroberg/catan-multi-player",own:"buddy",desc:"SoundKit — synthesized and file-based audio effects for browser apps (clicks, alerts, game SFX)."},
   {f:"trail",nm:"Trail — second-brain / RAG",kw:["memory","rag","second brain","knowledge base","embeddings","recall","remember","vector search","semantic search","what did we decide","notes memory","retrieval"],m:"runtime",i:"high",ext:1,via:"trail_save · trail_search (MCP) + cloud REST",src:"broberg-ai/trail",own:"trail",desc:"The fleet's cross-session second-brain + RAG — durable shared memory/knowledge across every cc-session. Save to it / search it via buddy's trail_save / trail_search MCP tools, or the cloud REST /api/v1/queue/candidates. A session that needs memory, embeddings, a knowledge base, or 'what did we already decide about X' should query Trail BEFORE building its own. Owned by broberg-ai/trail; mirrors cardmem's F149 'Trail — second brain + RAG' scaffold section. A searchable capability (not an npm) so q=memory/rag/knowledge-base/second-brain surfaces it."},
   {f:"F033",nm:"Deploy provider core + trigger UI",pkg:"@broberg/deploy-core",kw:["deploy","deployment","release","ship","trigger deploy","ci deploy","rollout","deploy button"],m:"hybrid",e:"L",i:"high",src:"webhouse/cms",own:"cms",desc:"The execution half of the former F027 — a deploy-provider core plus trigger UI (@broberg/deploy-core) that actually kicks off deploys."},
   {f:"changelog",nm:"Auto product-changelog",pkg:"@broberg/changelog",kw:["changelog","change log","release notes","product changelog","git history","what changed","release summary"],m:"runtime",e:"S",i:"medium",src:"webhouse/fysiodk-aalborg-sport",own:"fds (lift candidate)",desc:"Auto product-changelog from git history — a CLI/runtime that takes a git range, AI-rewrites the commits into honest product language (via @broberg/ai-sdk, ~$0.0005/ship), prepends CHANGELOG.md and commits; includes a 'no user-facing changes' detector for internal-only releases. Most fleet repos ship without an honest changelog (cms had none). A working reference impl runs in fysiodk-aalborg-sport (scripts/changelog.sh + changelog.mjs); candidate to lift to @broberg/changelog (graduate from fds, or components-owned). Suggested via the F038 Discovery sweep — not yet on npm (planned)."},
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
   {f:"db-sdk",nm:"Data SDK",pkg:"@broberg/db-sdk",kw:["database","db","sql","sqlite","libsql","turso","query","data access","orm","drizzle","data layer"],m:"runtime",s:"shipped",ver:"0.1.0",ext:1,src:"own repo",own:"db-sdk repo",desc:"The fleet Data SDK — typed database-access primitives shared across apps. Owned in its own repo and installed here, not built in components. Live on npm as @broberg/db-sdk v0.1.0."},
   {f:"ai-sdk",nm:"AI / LLM SDK",pkg:"@broberg/ai-sdk",kw:["ai","llm","claude","gpt","openai","anthropic","mistral","gemini","model","chat completion","embeddings","vision","transcribe","tts","translate","ocr","image generation","prompt","lora","lora training","train style","fine-tune image","style transfer","custom style","portrait","photorealistic","headshot","avatar generation","generate image","fal","fal.ai","flux","bfl","black forest labs","subject training","character lora","face lora","flux-2","reference image","reference images","face","image-to-video","img2vid","animate","veo","video generation","animate image"],m:"runtime",s:"shipped",ver:"0.17.1",ext:1,src:"broberg-ai/ai-sdk",own:"ai-sdk (broberg-ai/ai-sdk)",desc:"The fleet LLM SDK — a provider-agnostic facade (its OWN plain-fetch adapters, runtime dep = zod only; NOT a provider/Vercel SDK wrapper) so every app calls models the same way. Capabilities: chat · vision · video · translate · image · embedding · transcribe · ocr · moderate · podcast · tts · batch + prompt-contracts, with first-class per-call cost-tracking (tokens + USD + latency). Ships the F022 Model Availability Harness (resolveModel + listModels, zero hot-path I/O; browser-safe /registry subpath) so a suspended model (e.g. Fable 5, US export-control 2026-06-12) is grey-out/fallback-handled before it reaches a user. Tier routing: smart/powerful = Claude (what we code with); the `cheap` tier is NO LONGER $0 — claude -p is retired fleet-wide, cheap now routes to mistral-small-latest over HTTP (~$0.10/$0.30 per 1M, EU/GDPR-safe). Owner: broberg-ai/ai-sdk; supersedes the legacy @webhouse/ai. Live as @broberg/ai-sdk v0.17.1. CUSTOM-STYLE IMAGE GENERATION via LoRA: ai.trainStyle({images,isStyle,triggerWord,steps}) trains a LoRA on your images (~$2) → ai.image({prompt,lora,retryOnBlack}) generates from it (~$0.025/img) — style-LoRA is SHIPPED + proven on the Sanne style pilot (fal.ai/flux-lora-fast-training under the hood). Photorealistic PERSON/portrait generation is ai-sdk epic F023 — SHIPPED (v0.15.0), EU-resident via Black Forest Labs, in TWO modes: (1) RECOMMENDED, NO training step — ai.image({referenceImages:[1-8 photos]}) feeds reference photos straight into one FLUX 2 multi-reference generate call and returns the likeness in a single call (default flux-2-max $0.25/img; override:{model:'flux-2-pro'} ≈ half-price $0.12/img, near-identical likeness); (2) ai.image({finetune, finetuneStrength?}) for a dashboard-trained single subject at high volume (v0.14.0 — subject trained ONCE MANUALLY at dashboard.bfl.ai mode=character, since BFL retired finetune-create from the API). Both HARD-PIN the whole chain to BFL's EU hosts (submit/poll/deliver; a face = biometric personal data → GDPR strictest; never the global/US-failover host); real billed cost is read from the API (no pre-flight pricing endpoint exists — budget-gate up front with bflCredits()→{credits,usd}, EU-pinned, 1 credit=$0.01). Need style/portrait generation → ai-sdk is the source, don't roll your own provider call. Governance: faces are biometric personal data → broberg.ai does consent-based operational use ONLY, never deepfakes (do good, do no evil). IMAGE-TO-VIDEO is epic F024 (SHIPPED v0.17.0): ai.animate({image, prompt?}) → {url, bytes?, mimeType?, usage} animates a still into an ~8s/1080p clip (default audio: ambient sound matching the scene, no synthetic speech — overridable per prompt); default route is Veo 3.1 DIRECT via the Gemini API (veo-3.1-generate-preview, existing GEMINI_API_KEY, no aggregator markup; Veo's auth-gated result URI is downloaded for you), with fal.ai (Kling/Seedance/fal-Veo) as a pluggable override; real per-second cost (Veo 3.1 Standard $0.40/s, Fast $0.10, Lite $0.05). US-hosted today; an EU-managed route via Google Vertex is PENDING — gated on enabling the Vertex AI API on GCP (project-level 403 today, same in US + EU) then probing whether Veo is even served from a europe-west region, so EU residency is NEITHER confirmed available NOR confirmed blocked yet. consent-gated — a person's likeness only with sign-off, other figures fictional. (BFL does not do video.)"},
   {f:"upmetrics-sdk",nm:"Telemetry SDK",pkg:"@upmetrics/sdk",kw:["telemetry","metrics","error reporting","error tracking","monitoring","observability","sentry","cost tracking","logging"],m:"runtime",s:"shipped",ver:"0.2.0",ext:1,src:"broberg/upmetrics",own:"upmetrics",desc:"The fleet telemetry SDK — cost, error and metric reporting from any app. Owned by the upmetrics repo. Live as @upmetrics/sdk v0.2.0."},
   {f:"upmetrics-swift",nm:"Telemetry SDK (Swift)",pkg:"upmetrics-swift",kw:["swift","ios","macos","crash reporting","crash","error reporting","sentry","spm","swiftpm","mobile telemetry","apple"],m:"runtime",s:"shipped",ver:"0.1.0",ext:1,dist:"spm",src:"broberg-ai/upmetrics-swift",own:"upmetrics",desc:"Native iOS/macOS error + crash reporting — the Swift sibling of @upmetrics/sdk (same Sentry-envelope contract, public DSN only, async-signal-safe crash capture). Distributed via SwiftPM (git URL), NOT npm: .package(url: \"https://github.com/broberg-ai/upmetrics-swift\", from: \"0.1.0\") → product \"Upmetrics\". First consumers: buddy mobile, notesmem. When a new Swift app needs crash reporting → reuse this, don't build new."},
   {f:"fleet-client",nm:"Fleet client",pkg:"@broberg/fleet-client",kw:["fleet","intercom","dispatch","notify mobile","fleet comms","cross session","board digest","session messaging"],m:"runtime",s:"shipped",ver:"0.1.0",ext:1,src:"broberg-ai/fleet",own:"fleet (buddy F072)",desc:"The typed fleet-comms client — intercom dispatch, terminal provision, notify-mobile, board digest — validated against fleet-contracts before send. Owned by broberg-ai/fleet. Live as @broberg/fleet-client v0.1.0."},
   {f:"fleet-contracts",nm:"Fleet contracts",pkg:"@broberg/fleet-contracts",kw:["fleet","contracts","zod schemas","fleet endpoints","fleet comms","validation","schema"],m:"runtime",s:"shipped",ver:"0.1.0",ext:1,src:"broberg-ai/fleet",own:"fleet (buddy F072)",desc:"The fleet-comms contracts — zod schemas + FLEET_ENDPOINTS (the single source of truth) that fleet-client validates against. Owned by broberg-ai/fleet. Live as @broberg/fleet-contracts v0.1.0."},
   {f:"complimenta-sdk",nm:"Complimenta booking SDK",pkg:"@broberg/complimenta-sdk",kw:["complimenta","booking","reservation","appointment","openapi","oauth2","client credentials","booking sdk","integration","fdaa"],m:"runtime",s:"shipped",ver:"0.1.0",ext:1,src:"broberg-ai/fdaa",own:"fdaa",desc:"Typed client SDK for the Complimenta booking API — all 40 endpoints, types generated from their OpenAPI spec (openapi-typescript → schema.ts), OAuth2 client-credentials auth, zero runtime deps, Node/Bun/Next. Lives in the fdaa monorepo (packages/complimenta) — the FIRST @broberg package published from a monorepo subdir (token-bootstrapped v0.1.0 by components, then token-free OIDC from its own tag complimenta-sdk-v*). Owner: fdaa (broberg-ai/fdaa). Reuse if you integrate Complimenta. Live as @broberg/complimenta-sdk v0.1.0."},
 ]},
];

// The fleet roster — who builds & consumes the shared library (F038/inventory Fleet section).
export const FLEET = [
  { s:"components", r:"the shared-library home — this repo", pub:["theme","secret-scan","lens","seti-client","seti-server","mail","config","media","apikey"] },
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
    kw: ["fly","fly.io","flyctl","hosting","host","deploy","deployment","paas","container","machines","vm","app server"],
    region: "Always arn (Stockholm) — never US/Amsterdam",
    notes: "Fly.io is where most broberg.ai services run. The fleet rule is region arn (Stockholm) for every app — latency + data-residency consistency. Keep small services idle-cheap with autostop/autostart and min_machines_running=0; they cold-start in ~1s on the next request. Deploy with --remote-only so you don't need local Docker. Secrets live in flyctl secrets set (never in the image, never committed). Custom domains: fly certs add <domain>, then point DNS at the app (CNAME to <app>.fly.dev) — the Let's Encrypt cert validates automatically once DNS resolves.",
    tips: [
      { t: "Region is ALWAYS arn (Stockholm). Set primary_region = \"arn\" — never US/Amsterdam.", by: "components", tag: "region" },
      { t: "Idle-cheap services: auto_stop_machines = \"stop\" + auto_start_machines = true + min_machines_running = 0. Cold-start ~1s.", by: "components", tag: "cost" },
      { t: "fly deploy --remote-only builds on Fly's builder — no local Docker daemon needed.", by: "components", tag: "deploy" },
      { t: "Secrets via flyctl secrets set KEY=val (encrypted, injected at runtime). Never bake into the image or commit.", by: "components", tag: "secrets" },
      { t: "Custom domain: fly certs add <domain> first; the cert validates by itself once the DNS record resolves.", by: "components", tag: "tls" },
      { t: "Debug live: fly logs -a <app>, fly ssh console -a <app>, fly status. Health check on /health in [[http_service.checks]].", by: "components", tag: "ops" },
      { t: "flyctl ssh console -C does NOT parse as a shell — argv is split, so &&, ;, |, >, * become LITERAL args to the binary. One -C wiped all of /data once (rm got four path-args). One command per -C; for more, sftp a script then -C 'bash /tmp/x.sh'.", by: "trail", tag: "ssh-not-shell" },
      { t: "Before any rm -rf on a prod volume: snapshot first (flyctl volumes snapshots create <vol>) — auto-snapshots are only 5-day retention. Prefer find <path> -maxdepth 1 -name X -exec rm -rf {} + so a metachar can't widen the blast radius.", by: "trail", tag: "destructive-ops" },
      { t: "Stateful auth-apps need min_machines_running = 1 — autostop cold-starts lose in-flight WAL writes and drift OAuth state-cookies across instances (sessions drop mid-flight). ~$2-5/mo kills the bug class.", by: "trail", tag: "auth-warm-machine" },
      { t: "A cc-session in a Fly container needs >=2gb RAM — less and the OOM-killer hits it under prompt-load. Use machine-managed launch for long-running edge agents.", by: "buddy", tag: "sizing" },
      { t: "Single-machine app: deploy with --ha=false, else Fly spins a 2nd machine you didn't ask for. The 'not listening on expected address' smoke warning is transient — 'reached good state' + 'DNS verified' are what count.", by: "upmetrics", tag: "deploy" },
      { t: "Filesystem-stateful app (one volume) must NEVER fly scale count >1 / run multiple machines on the same volume — each gets its own copy then silent data divergence. Stay single-machine until state moves to a shared DB (Turso).", by: "cms", tag: "stateful" },
      { t: "SQLite + Litestream = ONE writer. Single volume + --ha=false; never multiple machines against the same volume (corruption).", by: "upmetrics", tag: "sqlite" },
      { t: "flyctl ssh writes as root, so files become root-owned and a non-root runtime user (e.g. uid 1001) gets EACCES writing them. Don't write runtime-writable paths via SSH; use the app's HTTP API, or chown -R in the same session (or at boot via gosu in the entrypoint).", by: "cms", tag: "permissions" },
      { t: "CI builder down (depot timeout)? Build arm64 locally then a Dockerfile.prebuilt that COPYs the prebuilt dist (skips vite-under-qemu) + flyctl deploy --local-only. Rescues prod when CD is red.", by: "cardmem", tag: "deploy-resilience" },
      { t: "SPA shell (index.html) MUST be Cache-Control: no-cache, else a stale index serves the old bundle after deploy. Verify on bundle-hash/content-marker, never curl-200.", by: "cardmem", tag: "spa-cache" },
      { t: "Run one-off in-container scripts without leaking secrets: base64-encode a small script and -C 'sh -c ...base64 -d > /tmp/x.js && bun /tmp/x.js; rm /tmp/x.js'. Secrets stay in the container; only the result comes out.", by: "upmetrics", tag: "ssh-secrets" },
      { t: "Repeated local Docker builds (e.g. fly deploy --local-only during a CI outage) fill the Docker VM's disk via build-cache → 'No space left on device' mid-build. Fix: docker builder prune -f && docker image prune -f (frees only unused; ~12GB back). Better: a prune step BEFORE each bypass-deploy, or bump Docker Desktop's disk allocation.", by: "cardmem", tag: "docker-disk" },
      { t: "The CI-outage deploy bypass (Dockerfile.prebuilt + a fly.toml dockerfile-override + .dockerignore negation) is TEMPORARY — NEVER commit it, it breaks normal CD. Revert to depot / normal CD the moment the builder is back.", by: "cardmem", tag: "deploy-resilience" },
    ],
  },
  {
    id: "cloudflare", name: "Cloudflare", role: "DNS, CDN, Turnstile, R2 — the rest of the stack",
    kw: ["cloudflare","dns","cdn","turnstile","captcha","r2","object storage","tunnel","edge","domain","nameserver","cname","bucket","buckets","cf","r2 provisioning","provision bucket","s3 creds"],
    region: "Global edge",
    notes: "Cloudflare hosts DNS for several fleet zones (e.g. broberg.ai), plus Turnstile (bot protection on forms), R2 (object storage — see @broberg/media) and CDN. The single biggest gotcha: when a subdomain CNAMEs to a Fly app, keep the record DNS-only (grey cloud) — an orange/proxied record makes Cloudflare's proxy fight Fly's Let's Encrypt validation and HTTPS breaks. For Turnstile, serve the site-key from a runtime endpoint so keys rotate without a rebuild; keys are domain-scoped (one Turnstile site per project).",
    tips: [
      { t: "CNAME → a Fly app MUST be DNS-only (grey cloud), not proxied (orange) — else Fly's TLS cert validation fails.", by: "components", tag: "dns" },
      { t: "Turnstile site-key from a runtime config endpoint (not a build-time env) → rotate keys without rebuild/redeploy.", by: "xrt81", tag: "turnstile" },
      { t: "Turnstile sites are domain-scoped — each project needs its own site (keys aren't reusable across domains).", by: "xrt81", tag: "turnstile" },
      { t: "Object storage = R2; consume via @broberg/media (provider-agnostic facade, R2 provider) rather than rolling raw S3 calls.", by: "components", tag: "storage" },
      { t: "Prefer CNAME over A/AAAA when pointing at Fly — survives Fly IP changes, no hardcoded IPs. TTL auto (Cloudflare-managed).", by: "buddy", tag: "dns" },
      { t: "R2 endpoint MUST be the .eu. host (https://<acct>.eu.r2.cloudflarestorage.com) for EU residency — without .eu. you get US. Presigned GET (no public bucket); multi-tenant via key-prefix.", by: "cardmem", tag: "gdpr" },
      { t: "An app-scoped CF_API_TOKEN (Pages/DNS/Turnstile) does NOT carry R2 Storage:Edit or User API Tokens:Edit — R2 needs a separately-scoped token.", by: "cms", tag: "tokens" },
      { t: "Incomplete TLS cert chain (wrong/missing intermediate) makes Node/Bun strict TLS fail 'unable to verify the first certificate' while curl/browsers tolerate it. Symptom: works in curl, fails in a server-runtime fetch.", by: "fdaa", tag: "tls" },
      { t: "Custom-domain cert ordering (GitHub Pages et al.): set DNS FIRST, wait ~30s to propagate, THEN attach the custom domain — the platform runs its DNS check at attach-time and queues the cert immediately; reverse order parks the request 25+ min.", by: "cms", tag: "cert-ordering" },
      { t: "A local dig/curl returning NXDOMAIN can be a STALE macOS mDNSResponder negative-cache (shared by every local session), not a real missing record. Verify against a public resolver — dig @1.1.1.1 <host> / curl --resolve — before calling a domain dead. (This nearly stalled a 15-repo rollout on a false alarm.)", by: "cardmem", tag: "dns-verify" },
      { t: "Need an R2 bucket? Provision it 100% programmatically (NO dashboard) via dns-mcp's R2Client / MCP tools: r2_list_buckets · r2_create_bucket · r2_create_scoped_token. Creates an EU-jurisdiction bucket + scoped S3 creds (access_key_id / secret / endpoint). EU jurisdiction is set AT creation and is IMMUTABLE → endpoint https://<acct>.eu.r2.cloudflarestorage.com. Proven live (bucket vnleker + read_write creds, S3-list 200).", by: "buddy", tag: "r2-provisioning" },
      { t: "R2 provisioning needs a token scoped Workers R2 Storage + User API Tokens Write (dns-mcp's CF_BOOTSTRAP_TOKEN, separate from CF_API_TOKEN). The ordinary DNS/zone-scoped CF_API_TOKEN CANNOT do R2 — you get an auth error. Don't waste time debugging the wrong token.", by: "buddy", tag: "r2-token" },
      { t: "Raw S3 creds from a scoped-token mint (access_key_id / secret / endpoint) go straight into the consumer's gitignored .env — NEVER over intercom or any chat surface. Treat them like any other secret.", by: "buddy", tag: "r2-creds-secrecy" },
    ],
  },
  {
    id: "resend", name: "Resend", role: "Transactional email (booking, magic-links, notifications)",
    kw: ["resend","email","mail","smtp","transactional email","send email","magic link","email delivery"],
    region: "—",
    notes: "Resend is the fleet's transactional-email provider. Don't roll your own client — consume @broberg/mail (the shared send primitive: ship-dark without a key, recipient allowlist so test/preview mail never hits real users, typed {ok,id,error} that never throws). Only send From a verified domain (check the Resend dashboard → Domains). Templates stay per-brand (F023); the package owns delivery only. Raw REST works on edge (no SDK needed).",
    tips: [
      { t: "Use @broberg/mail — don't hand-roll a Resend client. createMailer({apiKey, from, allowlist}) keeps your own env-var names.", by: "components", tag: "reuse" },
      { t: "Send only From a VERIFIED domain (Resend → Domains). An unverified From fails or tanks deliverability.", by: "components", tag: "domains" },
      { t: "Dev/preview: keep MAIL_LIVE off + an allowlist so test mail never reaches real users (fleet admins always pass).", by: "components", tag: "safety" },
      { t: "resend.batch.send strips attachments — send per-recipient when you embed inline cid: images.", by: "sanne", tag: "gotcha" },
      { t: "Wire the Resend webhook (Svix-signed) for delivered/opened/bounced/complained events.", by: "sanne", tag: "webhooks" },
      { t: "A send-only (restricted) API key 401s on GET /domains ({restricted_api_key}) — you CANNOT list verified domains with it. Check the dashboard then Domains, or just send: HTTP 200 from POST /emails confirms the From domain is verified.", by: "fdaa", tag: "restricted-key" },
      { t: "Keep the sender in an env var (RESEND_FROM), never hardcoded — a later domain switch (after SPF+DKIM+DMARC) is one secret-flip, zero code change.", by: "trail", tag: "verified-sender-env" },
    ],
  },
  {
    id: "supabase", name: "Supabase", role: "Postgres + auth (sanne, xrt81, fds, fdaa)",
    kw: ["supabase","postgres","postgresql","database","db","auth","authentication","storage","rls","row level security","sql"],
    region: "Always arn (Stockholm)",
    notes: "Supabase (Postgres + auth) backs several consumer apps. Provision in region arn. For Cardmem Lens to screenshot authed surfaces, mint a short-lived read-only session via @broberg/lens (keep ONLY your Supabase-specific signInWithPassword in createSession; the package owns bearer/ship-dark/TTL/cookie-domain). Watch the cookie-domain-behind-proxy trap: deriving cookie domain from the Host header yields 'localhost' behind Apache/Fly proxies, so the browser never sends the cookie to the real domain — pin LENS_COOKIE_DOMAIN. Keep the service-role key server-side only.",
    tips: [
      { t: "Provision in region arn (Stockholm) — same as Fly.", by: "components", tag: "region" },
      { t: "Authed Lens capture → @broberg/lens; keep only your signInWithPassword in createSession, package owns the rest.", by: "components", tag: "lens" },
      { t: "Cookie-domain trap: behind a proxy the Host header is 'localhost' → cookie never reaches the real domain. Pin LENS_COOKIE_DOMAIN.", by: "fds", tag: "gotcha" },
      { t: "service_role key is server-side ONLY — never ship it to the browser. Use a read-only/anon key client-side.", by: "components", tag: "security" },
      { t: "Email-security scanners (Outlook SafeLinks, Mimecast) PRE-FETCH confirmation/invite/recovery links, so the token is consumed on the scanner's GET before the user clicks and the user's click then fails ('link broken'). Fix: Click-to-Verify — GET renders a button page (consumes nothing); a POST consumes the token only on a real user click. Scanners only follow GET.", by: "fds", tag: "auth-scanner" },
      { t: "RLS silently drops pre-login audit events: events that fire before login (signup-fail, scanner-detected, verification-failed) hit an INSERT policy requiring auth.uid() IS NOT NULL, get rejected, and a swallowing catch hides it = zero history. Use a service-role admin client for legitimate unauth events + replace the silent catch with explicit console.error.", by: "fds", tag: "rls-observability" },
      { t: "Supabase removes auto-grants for new tables (Oct 30 2026). Always add explicit GRANT … TO service_role, authenticated (anon only if needed). SECURITY DEFINER fns: SET search_path = public, pg_catalog + REVOKE EXECUTE FROM anon, authenticated unless it IS an RPC.", by: "fds", tag: "grants" },
      { t: "@supabase/ssr cookie behind a proxy: sb-<ref>-auth-token domain is derived from request Host; behind Apache/nginx/Fly that can be 'localhost'/'0.0.0.0' so the browser NEVER sends the cookie (silent false-green). Pin the cookie domain. Bonus: the cookie SPLITS into .0/.1 chunks when large — handle as an array.", by: "fds", tag: "ssr-cookie-proxy" },
    ],
  },
  {
    id: "turso", name: "Turso / libSQL", role: "Edge SQLite — the @broberg/db-sdk backend",
    kw: ["turso","libsql","sqlite","edge database","edge db","database","db","embedded replica"],
    region: "Primary arn + embedded replicas",
    notes: "Turso (libSQL) is the fleet's edge-SQLite option, consumed through @broberg/db-sdk (the thin libSQL transport — don't bespoke a connector). Primary in arn; use embedded replicas for low-latency multi-region reads. Good fit for state that outgrows a per-machine Fly volume but doesn't need full Postgres.",
    tips: [
      { t: "Consume via @broberg/db-sdk (libSQL transport) rather than a bespoke client.", by: "components", tag: "reuse" },
      { t: "Primary DB in arn; add embedded replicas for fast multi-region reads.", by: "components", tag: "region" },
      { t: "Right tool when state outgrows a per-machine Fly volume but doesn't need full Postgres.", by: "components", tag: "fit" },
      { t: "A drizzle migration recorded in __drizzle_migrations is NOT proof the DDL landed. Verify BOTH the hash in the migrations table AND the actual effect (SELECT name FROM pragma_table_info('t') WHERE name='col'). A green migrate can leave the column absent.", by: "trail", tag: "migration-not-applied" },
      { t: "db.update().set() on bun:sqlite can SILENTLY drop a new column (value-independent, while sibling writes land) — workaround: a raw SQL UPDATE. Verify DB ground-truth via flyctl ssh, not the ORM return value.", by: "cardmem", tag: "drizzle-gotcha" },
    ],
  },
  {
    id: "npm", name: "npm / OIDC publishing", role: "How every @broberg/* package ships — token-free OIDC + provenance",
    kw: ["npm","publish","publishing","package","registry","oidc","provenance","trusted publisher","release","tag"],
    region: "—",
    notes: "All @broberg/* packages publish to npm via GitHub Actions OIDC Trusted Publishing — no NPM_TOKEN in CI, with provenance. Each package has a Trusted Publisher (repo + workflow filename) at npmjs.com and a tag-prefixed job in .github/workflows/publish.yml; v0.1.0 of a brand-new name is bootstrap-published by hand (a token in a temp gitignored .npmrc, never committed), then every release after runs token-free on a tag push. Mind the read-after-publish lag and the lightweight-tag trap below.",
    tips: [
      { t: "OIDC + --provenance REQUIRES a repository.url in package.json matching the GitHub repo, else npm 422s. (theme's first OIDC release hit exactly this.)", by: "components", tag: "oidc" },
      { t: "Do NOT set version: on pnpm/action-setup when the root package.json has a packageManager field — they conflict and the publish job fails.", by: "components", tag: "ci" },
      { t: "git push --follow-tags only pushes ANNOTATED tags. A lightweight git tag vX won't trigger a tag-gated publish workflow, so the release just doesn't happen. Use git tag -a … or push the tag explicitly (git push origin <tag>).", by: "ai-sdk", tag: "release-gotcha" },
      { t: "Right after publish, npm view / npm i can 404 for minutes — Fastly negative-cache, NOT a failed publish. The publish success line is authoritative; verify npm view <pkg>@<version> before claiming live (each probe re-seeds the negative cache, so don't hammer it).", by: "ai-sdk", tag: "publish-timing" },
      { t: "If a package's ROOT entry transitively imports a runtime builtin (bun:sqlite, node:zlib), a BROWSER build hard-fails. Ship a browser-clean subpath export (separate tsup entry + exports['./x']) and PROVE it with bun build --target=browser.", by: "ai-sdk", tag: "native-dep-isolation" },
      { t: "FIRST publish of a brand-new name is chicken-and-egg: npm's Trusted Publisher can't be configured until the package EXISTS, so v0.1.0 must be a token publish that CREATES it. Keep the org publish-token in ONE place (components) and let it bootstrap-publish first versions for the whole fleet — ping components (intercom) when your package is built, rather than copying a publish-everything token into N repos' .env. After v0.1.0 exists, Christian adds the Trusted Publisher and every later release is token-free.", by: "components", tag: "first-publish" },
      { t: "Publish a @broberg package from a MONOREPO subdir (not its own repo): add a tag-prefixed job (on push tag e.g. complimenta-sdk-v*) with working-directory: packages/<name>, permissions id-token:write, build+test, then `npm publish --provenance`. The Trusted Publisher points at THAT repo + the workflow filename — so one monorepo ships many independently-tagged @broberg packages. (broberg-ai/fdaa → @broberg/complimenta-sdk is the first.)", by: "components", tag: "monorepo" },
      { t: "Trusted Publisher setup (Christian, ~30s, ONLY after v0.1.0 exists): npmjs.com → the package → Settings → Trusted Publisher → GitHub Actions → Organization + Repository (e.g. broberg-ai/<repo>), Workflow filename (publish.yml), Environment left blank. Then a tag push publishes token-free with provenance — his single manual step per new package.", by: "components", tag: "trusted-publisher" },
    ],
  },
  {
    id: "pitch", name: "Pitch Vault", role: "Customer pitches — create, publish & share branded pitch pages",
    kw: ["pitch","pitches","customer pitch","sales pitch","presentation","proposal","pitch vault","deck","slides","pitch.broberg.dk"],
    region: "Fly arn (pitch.broberg.dk)",
    notes: "Pitch Vault (pitch.broberg.dk) is the fleet's service for creating + sharing customer pitches — a Next.js app on Fly (region arn) that hosts self-contained HTML/PDF pitch pages behind secure share links and tracks view analytics. DON'T build your own pitch tooling: push a self-contained HTML pitch via POST /api/cli/push (multipart, header x-api-key), generate one via POST /api/generate (Claude Haiku → a complete inline-styled HTML pitch, optionally styled from a template pitch), or use the `pitch push <dir>` CLI (config in ~/.pitchvaultrc). Read/search the existing vault via GET /api/v1/pitches?q=. The slug is the idempotent update key; isPublished=true to go live; share at /view/{token}.",
    tips: [
      { t: "Need a customer pitch? Use Pitch Vault, don't roll your own. POST /api/cli/push (multipart, x-api-key) with a self-contained HTML pitch → get a shareUrl back. Search existing pitches first: GET /api/v1/pitches?q=<term> (also ?folderId=).", by: "components", tag: "reuse" },
      { t: "Slug = the idempotent UPDATE key. Send the SAME slug to /api/cli/push to overwrite a pitch in-place (there's no separate edit endpoint); omit slug → a new pitch each time. Version via naming (e.g. -v2), not the API.", by: "components", tag: "idempotency" },
      { t: "isPublished defaults to FALSE — pass isPublished=true in the push to publish immediately, else the pitch exists but viewer/share links 404.", by: "components", tag: "publish" },
      { t: "Organize via folderId: GET /api/v1/folders first for the tree, then pass folderId in the push (null/omit = root). Folders are created in the web UI, not the API.", by: "components", tag: "folders" },
      { t: "Pitch HTML MUST be self-contained — inline <style>, base64 data-URIs for images, NO external CDN/API calls (they fail in the sandboxed viewer). Same F122 rule as our inventory mockups.", by: "components", tag: "self-contained" },
      { t: "Don't write from scratch: POST /api/generate (Claude Haiku) turns a brief into a complete self-contained HTML pitch, optionally styled from a template pitch. Real examples live in the repo's pitches/ dir.", by: "components", tag: "generate" },
      { t: "No delete API (web-UI only). To delete programmatically, ask the pitch session via intercom — it has the Fly-volume access. The x-api-key is a Fly secret; never commit it.", by: "components", tag: "delete-and-auth" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Links — npm package pages + PUBLIC source repos. Single source for BOTH the
// dashboard generator and the Discovery API. Repo links resolve ONLY to repos
// verified public on GitHub (snapshot 2026-06-16) so a click never 404s; private
// client repos (cardmem, sanne, fdaa, dns-mcp, buddy, xrt81, vn-leker, …) get an
// npm link but no repo link.
export const PUBLIC_REPOS = new Set([
  "broberg-ai/components", "broberg-ai/ai-sdk", "broberg-ai/fleet", "broberg-ai/trail",
  "broberg-ai/upmetrics", "broberg-ai/upmetrics-swift", "broberg-ai/notesmem",
  "webhousecode/cms", "cbroberg/codepromptmaker", "cbroberg/catan-multi-player",
]);

// The inventory `src` field is a loose label; map it to the canonical GitHub slug.
export const REPO_ALIASES = {
  "broberg/trail": "broberg-ai/trail",
  "broberg/upmetrics": "broberg-ai/upmetrics",
  "broberg/cardmem": "broberg-ai/cardmem",
  "broberg/xrt81": "broberg-ai/xrt81",
  "webhouse/cms": "webhousecode/cms",
  "webhouse/sanneandersen": "webhousecode/sanneandersen",
  "webhouse/fysiodk-aalborg-sport": "webhousecode/fysiodk-aalborg-sport",
  "webhouse/boilerplates-cms": "webhousecode/boilerplates-cms",
};

/** npmjs.com page for a shipped npm package (null for unshipped or SwiftPM-only). */
export function npmUrl(c) {
  if (!c || !c.pkg || c.s !== "shipped" || c.dist === "spm") return null;
  return `https://www.npmjs.com/package/${c.pkg}`;
}

/** github.com link to the source repo — ONLY when verified public, else null. */
export function repoUrl(c) {
  const raw = c && c.src;
  if (!raw || raw === "own repo" || raw === "—" || raw.includes("+")) return null;
  const slug = REPO_ALIASES[raw] ?? raw;
  return PUBLIC_REPOS.has(slug) ? `https://github.com/${slug}` : null;
}

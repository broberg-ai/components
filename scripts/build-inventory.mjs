// Generator for docs/inventory.html — the hi-fi Component Universe showcase.
// Single source of truth: the DATA array below (mirrors docs/INVENTORY.md). Re-run with:
//   node scripts/build-inventory.mjs
// Each card is clickable → a custom detail drawer (no native dialog) shows the
// component's facts + a "what it is" blurb. The page dogfoods @broberg/theme tokens.

import { writeFileSync } from "node:fs";

const M = { runtime: "📦", copy: "📋", scaffold: "🏗️", hybrid: "🔀" };
const MODEL = {
  runtime: "Runtime npm package — shared only when genuinely identical across ≥3 repos; installed and imported.",
  copy: "Copy-owned — copied into each app and free to diverge per brand.",
  scaffold: "Scaffold — a starting skeleton you stamp out, then own.",
  hybrid: "Hybrid — shared headless core plus a thin per-stack / per-brand adapter.",
};
const EFFORT = { S: "S (small)", M: "M (medium)", L: "L (large)" };

const DATA = [
 { n:"L0", t:"Rails", d:"foundation every app stands on", items:[
   {f:"F001",nm:"Design tokens + theme preset",pkg:"@broberg/theme",m:"hybrid",e:"M",i:"critical",s:"shipped",src:"webhouse/cms",own:"cms",desc:"The design-token foundation every surface inherits — light/dark across neutral/cool/warm theme variants as oklch CSS variables, a headless theme store with React and Preact adapters (no next-themes), plus a DESIGN.md to Tailwind-v4 generator with WCAG-AA contrast checking. Shipped to npm as @broberg/theme v0.2.0 — the keystone that unblocks every visual component below."},
   {f:"F002",nm:"Stack B base scaffold",pkg:"@broberg/stack-b-base",m:"scaffold",e:"M",i:"high",src:"broberg/cardmem",own:"cardmem",desc:"A ready-to-run base scaffold for Stack B apps (Bun · Hono · Preact · Tailwind v4) so a new lightweight service boots with the house wiring already in place."},
   {f:"F003",nm:"Stack A base scaffold",pkg:"@broberg/stack-a-base",m:"scaffold",e:"M",i:"high",src:"webhouse/boilerplates-cms",own:"boilerplates-cms",desc:"The Stack A counterpart — a Next.js 16 / React 19 / Tailwind v4 / shadcn base scaffold. The canonical variants are already maintained in boilerplates-cms; extraction into a create-* CLI is piloted there."},
   {f:"F004",nm:"Config single-source helper",pkg:"@broberg/config",m:"runtime",e:"S",i:"high",src:"broberg/xrt81",own:"xrt81",desc:"A single-source config helper — one typed place to read URLs, env and feature flags so values trickle down instead of being hardcoded in five files."},
   {f:"F005",nm:"Mail sending (Resend)",pkg:"@broberg/mail",m:"runtime",e:"S",i:"high",src:"webhouse/sanneandersen",own:"sanneandersen",desc:"Transactional mail sending over Resend — a thin runtime helper so any app can send a templated email with one call."},
   {f:"F006",nm:"Media / Cloudflare R2",pkg:"@broberg/media-r2",m:"runtime",e:"M",i:"high",src:"broberg/cardmem",own:"cardmem",desc:"Object storage on Cloudflare R2 — upload, signed-URL and delete primitives for media, as a framework-agnostic runtime core."},
   {f:"F007",nm:"MCP Server Toolkit",pkg:"@broberg/mcp",m:"hybrid",e:"M",i:"high",src:"webhouse/cms",own:"cms",desc:"A toolkit for building MCP servers (the protocol every fleet tool speaks) — shared scaffolding and helpers so a new MCP server is mostly glue."},
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
];

let total=0, ship=0, grad=0, mv=0;
function card(it, layer){
  total++; if(it.s==="shipped")ship++; if(it.grad)grad++;
  const moved = it.s==="moved"; if(moved)mv++;
  const st = it.s==="shipped" ? "shipped" : moved ? "moved" : "backlog";
  const badge = st==="shipped" ? '<span class="badge b-ship">✅ shipped v0.2.0</span>'
    : moved ? '<span class="badge b-moved">↗ moved</span>'
    : '<span class="badge b-back">🚧 under construction</span>';
  const pkg = it.pkg ? `<div class="pkg has">${it.pkg}</div>`
    : moved ? `<div class="pkg">${it.note}</div>`
    : `<div class="pkg none">copy-owned scaffold</div>`;
  const ei = moved ? "" : `<span class="ei">${it.e} · ${it.i}</span>`;
  const gr = it.grad ? '<span class="grad" title="graduate-candidate">⬆</span>' : "";
  const cls = "c" + (st==="shipped"?" shipped":"") + (moved?" moved":"");
  const tid = "inv-card-" + it.f.toLowerCase();
  return `<div class="${cls}" data-status="${st}" data-layer="${layer}" data-model="${it.m}" data-grad="${it.grad?1:0}" data-f="${it.f}" data-testid="${tid}" role="button" tabindex="0" aria-haspopup="dialog"><div class="c-top"><span class="fnum">${it.f}</span><span class="nm">${it.nm}</span></div>${pkg}<div class="c-bot"><span class="model" title="${it.m}">${M[it.m]||""}</span>${ei}${gr}${badge}</div></div>`;
}
const layersHtml = DATA.map(L =>
  `<div class="layer" data-layer="${L.n}"><div class="layer-h"><span class="n">${L.n}</span><span class="t">${L.t}</span><span class="d">— ${L.d}</span></div><div class="grid">${L.items.map(it=>card(it,L.n)).join("")}</div></div>`
).join("\n");
const layerChips = `<button class="chip" data-testid="inv-filter-layer-all" data-l="all" aria-pressed="true">All</button>` +
  DATA.map(L=>`<button class="chip" data-testid="inv-filter-layer-${L.n.toLowerCase()}" data-l="${L.n}">${L.n}</button>`).join("");
const wip = total - ship - mv;

// Detail-drawer body HTML per component (built here so the browser JS stays tiny).
function detailHtml(it, layerN, layerT){
  const moved = it.s==="moved";
  const badge = it.s==="shipped" ? '<span class="badge b-ship">✅ shipped v0.2.0</span>'
    : moved ? '<span class="badge b-moved">↗ moved</span>'
    : '<span class="badge b-back">🚧 under construction</span>';
  const pkg = it.pkg ? `<div class="d-pkg">${it.pkg}</div>`
    : moved ? `<div class="d-pkg none">${it.note}</div>`
    : `<div class="d-pkg none">copy-owned scaffold — no npm package</div>`;
  let facts = '<dl class="d-facts">';
  facts += `<dt>Layer</dt><dd>${layerN} · ${layerT}</dd>`;
  facts += `<dt>Reuse</dt><dd>${M[it.m]} ${it.m}<div class="d-model">${MODEL[it.m]}</div></dd>`;
  if(!moved) facts += `<dt>Effort</dt><dd>${EFFORT[it.e]||it.e}</dd><dt>Impact</dt><dd>${it.i}</dd>`;
  if(it.grad) facts += `<dt>Graduate</dt><dd>⬆ gets its own repo + cardmem project</dd>`;
  facts += `<dt>Best source</dt><dd><code>${it.src}</code></dd>`;
  facts += `<dt>Owner</dt><dd>${it.own}</dd>`;
  facts += '</dl>';
  return `<div class="d-head"><span class="fnum">${it.f}</span>${badge}</div>`
    + `<h2 class="d-name" id="d-name">${it.nm}</h2>${pkg}${facts}`
    + `<div class="d-desc-h">What it is</div><div class="d-desc">${it.desc}</div>`;
}
const DETAIL = {};
DATA.forEach(L => L.items.forEach(it => { DETAIL[it.f] = detailHtml(it, L.n, L.t); }));

const CSS = `
  :root, [data-theme="dark"]{--bg:oklch(0.211 0 0);--panel:oklch(0.239 0 0);--card:oklch(0.262 0 0);--fg:oklch(0.985 0 0);--muted:oklch(0.66 0 0);--faint:oklch(0.52 0 0);--border:oklch(0.32 0 0);--primary:oklch(0.922 0 0);--primary-fg:oklch(0.205 0 0);--green:oklch(0.74 0.15 152);--amber:oklch(0.80 0.13 80);}
  [data-theme="dark-cool"]{--bg:oklch(0.175 0.015 255);--panel:oklch(0.22 0.015 255);--card:oklch(0.25 0.015 255);--fg:oklch(0.93 0.008 255);--muted:oklch(0.66 0.015 255);--faint:oklch(0.5 0.015 255);--border:oklch(0.33 0.012 255);--primary:oklch(0.922 0 0);--primary-fg:oklch(0.205 0 0);--green:oklch(0.74 0.15 152);--amber:oklch(0.80 0.13 80);}
  [data-theme="dark-warm"]{--bg:oklch(0.175 0.008 55);--panel:oklch(0.22 0.012 60);--card:oklch(0.25 0.012 60);--fg:oklch(0.90 0.012 75);--muted:oklch(0.64 0.015 60);--faint:oklch(0.5 0.015 60);--border:oklch(0.33 0.015 60);--primary:oklch(0.922 0 0);--primary-fg:oklch(0.205 0 0);--green:oklch(0.74 0.15 152);--amber:oklch(0.80 0.13 80);}
  [data-theme="light"]{--bg:oklch(0.985 0 0);--panel:oklch(0.97 0 0);--card:oklch(1 0 0);--fg:oklch(0.205 0 0);--muted:oklch(0.5 0 0);--faint:oklch(0.62 0 0);--border:oklch(0.9 0 0);--primary:oklch(0.25 0 0);--primary-fg:oklch(0.985 0 0);--green:oklch(0.52 0.15 152);--amber:oklch(0.58 0.13 70);}
  [data-theme="light-cool"]{--bg:oklch(0.98 0.004 255);--panel:oklch(0.96 0.008 255);--card:oklch(1 0 0);--fg:oklch(0.22 0.025 255);--muted:oklch(0.5 0.015 255);--faint:oklch(0.62 0.012 255);--border:oklch(0.88 0.01 255);--primary:oklch(0.25 0.02 255);--primary-fg:oklch(0.985 0 0);--green:oklch(0.52 0.15 152);--amber:oklch(0.58 0.13 70);}
  [data-theme="light-warm"]{--bg:oklch(0.98 0.01 85);--panel:oklch(0.96 0.012 80);--card:oklch(1 0 0);--fg:oklch(0.22 0.025 65);--muted:oklch(0.5 0.02 65);--faint:oklch(0.62 0.015 70);--border:oklch(0.86 0.02 75);--primary:oklch(0.25 0.02 65);--primary-fg:oklch(0.985 0 0);--green:oklch(0.52 0.15 152);--amber:oklch(0.58 0.13 60);}
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;transition:background .25s,color .25s}
  .wrap{max-width:1200px;margin:0 auto;padding:0 24px}
  .top{position:sticky;top:0;z-index:20;backdrop-filter:blur(12px);background:color-mix(in oklab,var(--bg) 80%,transparent);border-bottom:1px solid var(--border)}
  .top .wrap{display:flex;align-items:center;gap:16px;height:60px}
  .brand{font-weight:650;letter-spacing:-.01em;font-size:16px}
  .brand .at{color:var(--faint);font-weight:400}
  .spacer{flex:1}
  .seg{display:inline-flex;background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:3px;gap:2px}
  .seg button{font:inherit;font-size:12px;font-weight:600;color:var(--muted);background:none;border:0;border-radius:6px;padding:5px 11px;cursor:pointer;transition:.15s}
  .seg button:hover{color:var(--fg)}
  .seg button[aria-pressed="true"]{background:var(--card);color:var(--fg);box-shadow:0 1px 2px oklch(0 0 0 / .18)}
  .hero{padding:54px 0 30px}
  .hero h1{font-size:40px;line-height:1.05;font-weight:680;letter-spacing:-.025em;max-width:760px}
  .hero h1 .at{color:var(--faint);font-weight:400}
  .hero p{color:var(--muted);font-size:16px;margin-top:14px;max-width:640px}
  .hero code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--green);background:var(--panel);padding:2px 6px;border-radius:5px}
  .stats{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}
  .stat{background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:13px 18px;min-width:96px}
  .stat b{display:block;font-size:24px;font-weight:680;line-height:1}
  .stat span{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-top:5px;display:block}
  .stat.ship b{color:var(--green)}
  .featured{margin:30px 0 8px;background:linear-gradient(180deg,color-mix(in oklab,var(--green) 9%,var(--panel)),var(--panel));border:1px solid color-mix(in oklab,var(--green) 40%,var(--border));border-radius:16px;padding:22px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:20px}
  .featured .ttl{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green)}
  .featured h2{font-size:20px;font-weight:650;margin-top:4px}
  .featured .pkg{font:13px ui-monospace,monospace;color:var(--muted);margin-top:3px}
  .featured .cmd{margin-left:auto;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:11px 15px;font:13px ui-monospace,monospace;color:var(--fg)}
  .featured .cmd .p{color:var(--faint)}
  .controls{display:flex;flex-wrap:wrap;gap:18px;align-items:center;margin:34px 0 6px;padding-bottom:14px;border-bottom:1px solid var(--border)}
  .fil{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .fil .lbl{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin-right:2px}
  .chip{font:inherit;font-size:12.5px;color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:7px;padding:5px 11px;cursor:pointer;transition:.15s}
  .chip:hover{color:var(--fg);border-color:var(--faint)}
  .chip[aria-pressed="true"]{background:var(--primary);color:var(--primary-fg);border-color:var(--primary)}
  .legend{margin-left:auto;font-size:12px;color:var(--faint);display:flex;gap:11px;flex-wrap:wrap}
  .layer{margin-top:30px}
  .layer-h{display:flex;align-items:baseline;gap:11px;margin-bottom:13px}
  .layer-h .n{font:700 12px ui-monospace,monospace;letter-spacing:.1em;color:var(--green);background:color-mix(in oklab,var(--green) 14%,transparent);padding:2px 8px;border-radius:6px}
  .layer-h .t{font-size:17px;font-weight:650}
  .layer-h .d{font-size:13px;color:var(--faint)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:12px}
  .c{background:var(--card);border:1px solid var(--border);border-radius:13px;padding:14px 15px;display:flex;flex-direction:column;gap:9px;min-height:104px;cursor:pointer;transition:transform .14s,border-color .14s,box-shadow .14s}
  .c:hover{transform:translateY(-2px);border-color:var(--faint);box-shadow:0 8px 24px oklch(0 0 0 / .22)}
  .c:focus-visible{outline:2px solid var(--green);outline-offset:2px}
  .c:active{transform:translateY(0) scale(.997)}
  .c.shipped{border-color:color-mix(in oklab,var(--green) 55%,var(--border));box-shadow:0 0 0 1px color-mix(in oklab,var(--green) 26%,transparent) inset}
  .c.moved{opacity:.6;border-style:dashed}
  .c.hide{display:none}
  .c-top{display:flex;align-items:flex-start;gap:9px}
  .fnum{font:600 11px ui-monospace,monospace;color:var(--faint);background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:2px 7px;white-space:nowrap}
  .nm{font-weight:600;font-size:14px;line-height:1.3}
  .pkg{font:11.5px ui-monospace,monospace;color:var(--muted)}
  .pkg.has{color:var(--green)}
  .pkg.none{color:var(--faint);opacity:.7}
  .c-bot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:auto;font-size:11.5px;color:var(--muted)}
  .model{font-size:14px}
  .ei{color:var(--faint)}
  .grad{color:var(--amber);font-weight:700;cursor:default}
  .badge{border-radius:6px;padding:2.5px 8px;font-size:10.5px;font-weight:700;letter-spacing:.02em;margin-left:auto;white-space:nowrap}
  .b-ship{background:color-mix(in oklab,var(--green) 20%,transparent);color:var(--green)}
  .b-back{background:var(--panel);color:var(--faint);border:1px solid var(--border)}
  .b-moved{background:color-mix(in oklab,var(--amber) 18%,transparent);color:var(--amber)}
  .drawer-backdrop{position:fixed;inset:0;z-index:40;background:oklch(0 0 0 / .5);opacity:0;pointer-events:none;transition:opacity .2s}
  .drawer-backdrop.open{opacity:1;pointer-events:auto}
  .drawer{position:fixed;top:0;right:0;z-index:41;height:100%;width:440px;max-width:92vw;background:var(--panel);border-left:1px solid var(--border);box-shadow:-14px 0 44px oklch(0 0 0 / .32);transform:translateX(100%);transition:transform .24s cubic-bezier(.4,0,.2,1);overflow-y:auto;padding:26px 26px 44px}
  .drawer.open{transform:translateX(0)}
  .drawer-x{position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--muted);font-size:14px;cursor:pointer;transition:.15s;display:flex;align-items:center;justify-content:center}
  .drawer-x:hover{color:var(--fg);border-color:var(--faint)}
  .drawer-x:active{transform:scale(.92)}
  .drawer-x:focus-visible{outline:2px solid var(--green);outline-offset:2px}
  .d-head{display:flex;align-items:center;gap:9px;margin-bottom:13px;padding-right:42px;min-height:32px}
  .d-name{font-size:21px;font-weight:680;letter-spacing:-.02em;line-height:1.2;margin-bottom:7px;padding-right:34px}
  .d-pkg{font:12.5px ui-monospace,monospace;color:var(--green)}
  .d-pkg.none{color:var(--faint)}
  .d-facts{display:grid;grid-template-columns:auto 1fr;gap:9px 16px;margin:18px 0;padding:16px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
  .d-facts dt{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);font-weight:700;padding-top:1px}
  .d-facts dd{font-size:13px;color:var(--fg)}
  .d-facts dd code{font:12px ui-monospace,monospace;background:var(--card);padding:1px 6px;border-radius:5px}
  .d-model{font-size:12.5px;color:var(--muted);line-height:1.5;margin-top:3px}
  .d-desc-h{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);font-weight:700;margin:0 0 7px}
  .d-desc{font-size:14px;line-height:1.62;color:var(--fg)}
  footer{margin:48px 0 64px;border-top:1px solid var(--border);padding-top:26px;display:grid;grid-template-columns:1fr 1fr;gap:30px}
  footer h3{font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--faint);text-transform:uppercase;margin-bottom:12px}
  .spoke{font-size:13px;color:var(--muted);margin:5px 0}
  .spoke b{color:var(--fg)}
  .spoke .me{color:var(--green);font-weight:600}
  .spoke small{color:var(--faint);font-size:11px;margin-left:5px}
  .cp p{font-size:13px;color:var(--muted);line-height:1.6}
  .cp code{font:12px ui-monospace,monospace;color:var(--fg);background:var(--panel);padding:1.5px 6px;border-radius:5px}
  @media(max-width:760px){
    .wrap{padding:0 16px}
    .top .wrap{height:auto;min-height:60px;flex-wrap:wrap;padding:10px 16px;gap:8px}
    .brand{flex:1 0 100%}
    .spacer{display:none}
    .seg button{padding:5px 9px;font-size:11px}
    .hero{padding:30px 0 20px}
    .hero h1{font-size:29px}
    .hero p{font-size:14.5px}
    .stat{flex:1 1 calc(50% - 6px);min-width:0}
    .featured{flex-direction:column;align-items:flex-start;gap:14px}
    .featured .cmd{margin-left:0}
    .controls{gap:12px}
    .legend{margin-left:0;width:100%;order:3}
    .grid{grid-template-columns:1fr}
    .drawer{width:100%;max-width:100%}
    footer{grid-template-columns:1fr;gap:22px}
  }
`;

const JS = [
"(function(){",
"var DETAIL=" + JSON.stringify(DETAIL) + ";",
"var modeEl=document.getElementById('mode'),tempEl=document.getElementById('temp');",
"var mode='dark',temp='';",
"function applyTheme(){document.documentElement.setAttribute('data-theme',mode+temp);}",
"if(modeEl)modeEl.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;mode=b.getAttribute('data-m');Array.prototype.forEach.call(modeEl.children,function(x){x.setAttribute('aria-pressed',x===b);});applyTheme();});",
"if(tempEl)tempEl.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;temp=b.getAttribute('data-t');Array.prototype.forEach.call(tempEl.children,function(x){x.setAttribute('aria-pressed',x===b);});applyTheme();});",
"var fl='all',fs='all',fmod='all',fg='all';",
"function applyFilters(){",
"  Array.prototype.forEach.call(document.querySelectorAll('.c'),function(c){",
"    var ok=(fl==='all'||c.getAttribute('data-layer')===fl)&&(fs==='all'||c.getAttribute('data-status')===fs)&&(fmod==='all'||c.getAttribute('data-model')===fmod)&&(fg==='all'||c.getAttribute('data-grad')===fg);",
"    c.classList.toggle('hide',!ok);});",
"  Array.prototype.forEach.call(document.querySelectorAll('.layer'),function(sec){",
"    var any=Array.prototype.some.call(sec.querySelectorAll('.c'),function(c){return !c.classList.contains('hide');});",
"    sec.style.display=any?'':'none';});}",
"function wire(id,attr,setter){var el=document.getElementById(id);if(!el)return;el.addEventListener('click',function(e){var b=e.target.closest('.chip');if(!b)return;setter(b.getAttribute(attr));Array.prototype.forEach.call(el.querySelectorAll('.chip'),function(x){x.setAttribute('aria-pressed',x===b);});applyFilters();});}",
"wire('f-layer','data-l',function(v){fl=v;});",
"wire('f-status','data-s',function(v){fs=v;});",
"wire('f-model','data-mod',function(v){fmod=v;});",
"wire('f-grad','data-g',function(v){fg=v;});",
"var drawer=document.getElementById('drawer'),dback=document.getElementById('dback'),dbody=document.getElementById('dbody'),dclose=document.getElementById('dclose');",
"var lastFocus=null;",
"function openDrawer(el){var h=DETAIL[el.getAttribute('data-f')];if(!h)return;lastFocus=el;dbody.innerHTML=h;drawer.classList.add('open');dback.classList.add('open');drawer.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';if(dclose)dclose.focus();}",
"function closeDrawer(){drawer.classList.remove('open');dback.classList.remove('open');drawer.setAttribute('aria-hidden','true');document.body.style.overflow='';if(lastFocus)lastFocus.focus();}",
"Array.prototype.forEach.call(document.querySelectorAll('.c'),function(c){c.addEventListener('click',function(){openDrawer(c);});c.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openDrawer(c);}});});",
"if(dclose)dclose.addEventListener('click',closeDrawer);",
"if(dback)dback.addEventListener('click',closeDrawer);",
"document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDrawer();});",
"})();",
].join("\n");

const HTML = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@broberg — Component Universe</title>
<style>${CSS}</style>
</head>
<body>
  <div class="top"><div class="wrap">
    <span class="brand"><span class="at">@broberg/</span>components</span>
    <span class="spacer"></span>
    <div class="seg" id="mode"><button data-m="dark" aria-pressed="true">Dark</button><button data-m="light">Light</button></div>
    <div class="seg" id="temp"><button data-t="" aria-pressed="true">Neutral</button><button data-t="-cool">Cool</button><button data-t="-warm">Warm</button></div>
  </div></div>
  <div class="wrap">
    <section class="hero">
      <h1><span class="at">The </span>Component Universe</h1>
      <p>The curated shared-component library across the broberg.ai estate — ${total} components in 5 layers, best-implementation-per-pattern, extracted into <code>@broberg/*</code> packages. Idea → running platform in days. <em>This page renders with the very tokens it documents — click any card to read more.</em></p>
      <div class="stats">
        <div class="stat"><b>${total}</b><span>components</span></div>
        <div class="stat ship"><b>${ship}</b><span>shipped</span></div>
        <div class="stat"><b>${wip}</b><span>under construction</span></div>
        <div class="stat"><b>${grad}</b><span>graduate</span></div>
      </div>
    </section>
    <section class="featured">
      <div>
        <div class="ttl">✅ Shipped</div>
        <h2>Design tokens + theme preset</h2>
        <div class="pkg">@broberg/theme · v0.2.0 · Tailwind v4 · headless core + React/Preact + DESIGN.md→v4 generator</div>
      </div>
      <div class="cmd"><span class="p">$</span> npm i @broberg/theme</div>
    </section>
    <div class="controls">
      <div class="fil" id="f-layer"><span class="lbl">Layer</span>${layerChips}</div>
      <div class="fil" id="f-status"><span class="lbl">Status</span><button class="chip" data-testid="inv-filter-status-all" data-s="all" aria-pressed="true">All</button><button class="chip" data-testid="inv-filter-status-shipped" data-s="shipped">✅ Shipped</button><button class="chip" data-testid="inv-filter-status-backlog" data-s="backlog">🚧 Under construction</button></div>
      <div class="fil" id="f-model"><span class="lbl">Model</span><button class="chip" data-testid="inv-filter-model-all" data-mod="all" aria-pressed="true">All</button><button class="chip" data-testid="inv-filter-model-runtime" data-mod="runtime">📦 Runtime</button><button class="chip" data-testid="inv-filter-model-copy" data-mod="copy">📋 Copy-owned</button><button class="chip" data-testid="inv-filter-model-scaffold" data-mod="scaffold">🏗️ Scaffold</button><button class="chip" data-testid="inv-filter-model-hybrid" data-mod="hybrid">🔀 Hybrid</button></div>
      <div class="fil" id="f-grad"><span class="lbl">Show</span><button class="chip" data-testid="inv-filter-grad-all" data-g="all" aria-pressed="true">All</button><button class="chip" data-testid="inv-filter-grad-only" data-g="1"><span class="grad">⬆</span> Graduate only</button></div>
    </div>
    <div class="legend"><span class="b-moved" style="border-radius:6px;padding:1px 7px">↗ moved</span> = re-homed to another repo · everything else is filterable above</div>
    ${layersHtml}
    <footer>
      <div>
        <h3>Fleet shared-library wheel</h3>
        <div class="spoke">UI / app-shell → <span class="me">components (this)</span></div>
        <div class="spoke">Data → <b>@broberg/db-sdk</b></div>
        <div class="spoke">LLM → <b>@broberg/ai-sdk</b></div>
        <div class="spoke">Telemetry → <b>@upmetrics/sdk</b></div>
        <div class="spoke">Fleet comms → <b>@broberg/fleet-client</b></div>
        <div class="spoke">Security → <span class="me">@broberg/secret-scan</span> <small>✅ shipped · components-owned</small></div>
        <div class="spoke">Lens-compliance → <span class="me">@broberg/lens</span> <small>✅ shipped · components-owned</small></div>
      </div>
      <div class="cp">
        <h3>Critical path</h3>
        <p><code>F001 @broberg/theme</code> (shipped) is the keystone — it unblocks 8 downstream UI components, and everything visual inherits its tokens. It was the first card built; the rest of L0 (config, mail, R2, MCP-toolkit) follows.</p>
      </div>
    </footer>
  </div>
  <div class="drawer-backdrop" id="dback" data-testid="inv-detail-backdrop"></div>
  <aside class="drawer" id="drawer" data-testid="inv-detail" role="dialog" aria-modal="true" aria-labelledby="d-name" aria-hidden="true">
    <button class="drawer-x" id="dclose" data-testid="inv-detail-close" aria-label="Close details">✕</button>
    <div id="dbody"></div>
  </aside>
<script>${JS}</script>
</body>
</html>
`;
writeFileSync(new URL("../docs/inventory.html", import.meta.url), HTML);
console.log("wrote docs/inventory.html — total=" + total + " shipped=" + ship + " wip=" + wip + " grad=" + grad + " moved=" + mv + " detail-entries=" + Object.keys(DETAIL).length);

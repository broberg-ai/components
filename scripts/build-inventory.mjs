// Generator for docs/inventory.html — the hi-fi Component Universe showcase.
// Single source of truth: the DATA array below (mirrors docs/INVENTORY.md). Re-run with:
//   node scripts/build-inventory.mjs
// To regenerate AND push the hosted cardmem mockup in one step:
//   bash scripts/sync-mockup.sh   (keeps cardmem.com/mockups/… from going stale)
// Each card is clickable → a custom detail drawer (no native dialog) shows the
// component's facts + a "what it is" blurb. The page dogfoods @broberg/theme tokens.

import { writeFileSync } from "node:fs";
import { FAVICON } from "./favicon.mjs";
import { SITE_CSS as CSS, topBar, THEME_JS, tagLinks, SEARCH_MODAL, SEARCH_JS } from "./site-chrome.mjs";
import { M, MODEL, EFFORT, DATA, FLEET, INFRA, npmUrl, repoUrl, oneLiner } from "./inventory-data.mjs";
// F083 — the FLEET section renders from the SCANNED manifests, not from a
// hand-written array. Measured the day it changed: the array showed 15 of 149
// real dependencies and omitted eight repos entirely.
import { fleetRows, scanLine } from "./fleet-graph.mjs";
import { readFileSync as readScan } from "node:fs";
let FLEET_SCAN = { repos: {} };
try { FLEET_SCAN = JSON.parse(readScan(new URL("../data/fleet-deps.json", import.meta.url), "utf8")); } catch {}
const FLEET_ROWS = fleetRows(FLEET_SCAN);
import { fetchLatestReleases } from "./npm-latest.mjs";
import { npmMeta, npmMetaRow, daTime, PROVENANCE_LABEL } from "./npm-meta.mjs";
import { writeFileSync as writeMeta } from "node:fs";

// F038.7 + F038.31 — asked of the registry once, BEFORE the cards render, so each
// card can carry its own npm link, publish time and provenance.
const SHIPPED_PKGS = DATA.flatMap((L) => L.items ?? [])
  .filter((it) => it.s === "shipped" && String(it.pkg ?? "").startsWith("@broberg/"));
const releases = await fetchLatestReleases(SHIPPED_PKGS.map((it) => it.pkg));
// /api/packages and llms.txt read the same facts from here (one fetch, one source).
writeMeta(new URL("../docs/npm-meta.json", import.meta.url), JSON.stringify(Object.fromEntries(SHIPPED_PKGS.map((it) => [it.pkg, npmMeta(it.pkg, releases)])), null, 1) + "\n");


let total=0, ship=0, grad=0, mv=0;
function card(it, layer){
  total++; if(it.s==="shipped")ship++; if(it.grad)grad++;
  const moved = it.s==="moved"; if(moved)mv++;
  const st = it.s==="shipped" ? "shipped" : moved ? "moved" : "backlog";
  const badge = st==="shipped" ? `<span class="badge b-ship">✅ v${it.ver||""}</span>`
    : moved ? '<span class="badge b-moved">↗ moved</span>'
    : '<span class="badge b-back">🚧 under construction</span>';
  const pkg = it.pkg ? `<div class="pkg has">${it.pkg}</div>`
    : it.via ? `<div class="pkg has">${it.via}</div>`
    : moved ? `<div class="pkg">${it.note}</div>`
    : `<div class="pkg none">copy-owned scaffold</div>`;
  const ei = (moved||it.ext) ? "" : `<span class="ei">${it.e} · ${it.i}</span>`;
  const own = it.ext ? `<span class="own">own: ${it.own}</span>` : "";
  const gr = it.grad ? '<span class="grad" title="graduate-candidate">⬆</span>' : "";
  const cls = "c" + (st==="shipped"?" shipped":"") + (moved?" moved":"");
  const tid = "inv-card-" + it.f.toLowerCase();
  // F038.31 — the npm link, publish time and provenance ON the card, not only in the drawer.
  const npmRow = npmUrl(it) && String(it.pkg).startsWith("@broberg/") ? npmMetaRow(it.f.toLowerCase(), npmMeta(it.pkg, releases)) : "";
  return `<div class="${cls}" data-status="${st}" data-layer="${layer}" data-model="${it.m}" data-grad="${it.grad?1:0}" data-f="${it.f}" data-testid="${tid}" role="button" tabindex="0" aria-haspopup="dialog"><div class="c-top"><span class="fnum">${it.f}</span><span class="nm">${it.nm}</span></div>${pkg}${npmRow}<div class="c-bot"><span class="model" title="${it.m}">${M[it.m]||""}</span>${ei}${own}${gr}${badge}</div></div>`;
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
  const badge = it.s==="shipped" ? `<span class="badge b-ship">✅ v${it.ver||""}</span>`
    : moved ? '<span class="badge b-moved">↗ moved</span>'
    : '<span class="badge b-back">🚧 under construction</span>';
  const pkg = it.pkg ? `<div class="d-pkg">${it.pkg}${badge}</div>`
    : it.via ? `<div class="d-pkg">${it.via}${badge}</div>`
    : moved ? `<div class="d-pkg none">${it.note}${badge}</div>`
    : `<div class="d-pkg none">copy-owned scaffold — no npm package${badge}</div>`;
  let facts = '<dl class="d-facts">';
  facts += `<dt>Layer</dt><dd>${layerN} · ${layerT}</dd>`;
  facts += `<dt>Reuse</dt><dd>${M[it.m]} ${it.m}<div class="d-model">${MODEL[it.m]}</div></dd>`;
  if(it.s==="shipped" && it.ver) facts += `<dt>Version</dt><dd>v${it.ver} · ${it.dist==="spm"?"live via SwiftPM":"live on npm"}</dd>`;
  if(!moved && !it.ext) facts += `<dt>Effort</dt><dd>${EFFORT[it.e]||it.e}</dd><dt>Impact</dt><dd>${it.i}</dd>`;
  if(it.grad) facts += `<dt>Graduate</dt><dd>⬆ gets its own repo + cardmem project</dd>`;
  facts += `<dt>Best source</dt><dd><code>${it.src}</code></dd>`;
  facts += `<dt>Owner</dt><dd>${it.own}</dd>`;
  // F038.37 — keywords as clickable tags → /packages?tag=…
  if ((it.kw ?? []).length) facts += `<dt>Nøgleord</dt><dd>${tagLinks(it.kw, "d-tag-" + it.f.toLowerCase() + "-")}</dd>`;
  // F038.31 — when the data behind this drawer is from. Each line names its own
  // source time; there is deliberately no "page built at" line, because that
  // would change on every build and fail the docs-in-sync gate (F083.6).
  if (npmUrl(it) && String(it.pkg).startsWith("@broberg/")) {
    const meta = npmMeta(it.pkg, releases);
    const when = daTime(meta.publishedAt);
    facts += `<dt>Udgivet</dt><dd data-testid="d-published-${it.f.toLowerCase()}">${meta.version ? `v${meta.version} · ` : ""}${when ?? "ukendt"}</dd>`;
    facts += `<dt>Trusted Publisher</dt><dd data-testid="d-provenance-${it.f.toLowerCase()}">${PROVENANCE_LABEL[meta.provenance]}</dd>`;
  }
  const scanWhen = daTime(FLEET_SCAN.scanned_at);
  facts += `<dt>Forbrugere scannet</dt><dd data-testid="d-scanned-${it.f.toLowerCase()}">${scanWhen ?? "aldrig"}</dd>`;
  const nUrl = npmUrl(it), rUrl = repoUrl(it), fid = it.f.toLowerCase();
  if(nUrl || rUrl){
    const links = [
      nUrl ? `<a href="${nUrl}" target="_blank" rel="noopener" data-testid="d-link-npm-${fid}">npm ↗</a>` : "",
      rUrl ? `<a href="${rUrl}" target="_blank" rel="noopener" data-testid="d-link-repo-${fid}">GitHub ↗</a>` : "",
    ].filter(Boolean).join('<span class="d-links-sep">·</span>');
    facts += `<dt>Links</dt><dd class="d-links">${links}</dd>`;
  }
  facts += '</dl>';
  // Copy-to-clipboard — only for a package that is actually live on npm (nUrl is
  // non-null solely for shipped npm packages, never SwiftPM/scaffold/moved). The
  // pkg name + version + npm url ride as data-attrs; the drawer JS assembles the
  // clipboard text (name@version \n url) so there is no newline-in-attribute.
  // Copy sits as an icon button beside the ✕ close (same button type + height),
  // absolutely positioned top-right of the drawer. Icon-only + title/aria-label.
  const copyBtn = (nUrl && it.ver && it.pkg)
    ? `<button type="button" class="d-copy-x" title="Copy npm ref — ${it.pkg}@${it.ver}" aria-label="Copy npm ref — ${it.pkg}@${it.ver}" data-testid="d-copy-${fid}" data-pkg="${it.pkg}" data-ver="${it.ver}" data-npm="${nUrl}"><span class="d-copy-ic" aria-hidden="true">⧉</span></button>`
    : "";
  return copyBtn
    + `<div class="d-head"><span class="fnum">${it.f}</span></div>`
    + `<h2 class="d-name" id="d-name">${it.nm}</h2>${pkg}`
    // F038.38 — a published package has its own page; say so at the TOP, not under the fold.
    + (nUrl ? `${it.sum ? `<p class="d-sum">${it.sum}</p>` : ""}<a class="d-pkgpage" href="/packages/${it.pkg}" data-testid="d-pkgpage-${fid}">Åbn pakkeside →</a>` : "")
    + `${facts}`
    + `<div class="d-desc-h">What it is</div><div class="d-desc">${it.desc}</div>`;
}
const DETAIL = {};
DATA.forEach(L => L.items.forEach(it => { DETAIL[it.f] = detailHtml(it, L.n, L.t); }));
function infraDetailHtml(p){
  const n = (p.tips||[]).length;
  const tips = (p.tips||[]).map(t=>`<li><span class="tip-t">${t.t}</span><span class="tip-by">— ${t.by||"fleet"}${t.tag?` · ${t.tag}`:""}</span></li>`).join("");
  return `<div class="d-head"><span class="fnum">INFRA</span><span class="badge b-ship">${n} tips</span></div>`
    + `<h2 class="d-name" id="d-name">${p.name}</h2><div class="d-pkg">${p.role}</div>`
    + `<dl class="d-facts"><dt>Region</dt><dd>${p.region||"—"}</dd><dt>Tips</dt><dd>${n} best-practices</dd></dl>`
    + `<div class="d-desc-h">Overview</div><div class="d-desc">${p.notes||""}</div>`
    + (tips?`<div class="d-desc-h" style="margin-top:18px">Tips &amp; gotchas</div><ul class="tips">${tips}</ul>`:"");
}
INFRA.forEach(p => { DETAIL["infra-"+p.id] = infraDetailHtml(p); });


// Flat search index for the ⌘K command palette (F038.3) — one row per
// component/package + infra entry, matched on name/pkg/F-number/keywords/layer.
const SEARCH_INDEX = [];
DATA.forEach((L) => L.items.forEach((it) => SEARCH_INDEX.push({
  f: it.f, nm: it.nm, pkg: it.pkg || it.via || "", layer: L.n, kw: (it.kw || []).join(" "),
  // F038.38 — a published package opens its page; the summary is searchable too.
  sum: it.sum || "", href: npmUrl(it) ? "/packages/" + it.pkg : "",
})));
INFRA.forEach((p) => SEARCH_INDEX.push({
  f: "infra-" + p.id, nm: p.name, pkg: "", layer: "INFRA",
  kw: (p.tips || []).map((t) => t.t).join(" ").slice(0, 160),
}));

const JS = [
"(function(){",
"var DETAIL=" + JSON.stringify(DETAIL) + ";",
"var SEARCH=" + JSON.stringify(SEARCH_INDEX) + ";",
THEME_JS,
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
"var fip='all';",
"function applyInfraFilter(){Array.prototype.forEach.call(document.querySelectorAll('.ic'),function(c){c.classList.toggle('hide',!(fip==='all'||c.getAttribute('data-pid')===fip));});}",
"(function(){var el=document.getElementById('f-infra');if(!el)return;el.addEventListener('click',function(e){var b=e.target.closest('.chip');if(!b)return;fip=b.getAttribute('data-ip');Array.prototype.forEach.call(el.querySelectorAll('.chip'),function(x){x.setAttribute('aria-pressed',x===b);});applyInfraFilter();});})();",
"var drawer=document.getElementById('drawer'),dback=document.getElementById('dback'),dbody=document.getElementById('dbody'),dclose=document.getElementById('dclose');",
"var lastFocus=null;",
"function openDrawer(el){lastFocus=el;openDrawerByF(el.getAttribute('data-f'));}",
"function openDrawerByF(f){var h=DETAIL[f];if(!h)return;dbody.innerHTML=h;drawer.classList.add('open');dback.classList.add('open');drawer.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';if(dclose)dclose.focus();}",
"function closeDrawer(){drawer.classList.remove('open');dback.classList.remove('open');drawer.setAttribute('aria-hidden','true');document.body.style.overflow='';if(lastFocus)lastFocus.focus();}",
"Array.prototype.forEach.call(document.querySelectorAll('.c,.ic'),function(c){c.addEventListener('click',function(){openDrawer(c);});c.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openDrawer(c);}});});",
"if(dclose)dclose.addEventListener('click',closeDrawer);",
"if(dback)dback.addEventListener('click',closeDrawer);",
"document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDrawer();});",
"function legacyCopy(t){try{var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();var ok=document.execCommand('copy');document.body.removeChild(ta);return ok;}catch(_){return false;}}",
"if(dbody)dbody.addEventListener('click',function(e){var b=e.target.closest('.d-copy-x');if(!b)return;var ic=b.querySelector('.d-copy-ic');var txt=b.getAttribute('data-pkg')+'@'+b.getAttribute('data-ver')+'\\n'+b.getAttribute('data-npm');function flash(ok){b.classList.remove('ok','err');b.classList.add(ok?'ok':'err');if(ic)ic.textContent=ok?'✓':'!';setTimeout(function(){b.classList.remove('ok','err');if(ic)ic.textContent='⧉';},1600);}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){flash(true);},function(){flash(legacyCopy(txt));});}else{flash(legacyCopy(txt));}});",
"window.__DISC_SEARCH=SEARCH;window.__DISC_OPEN_F=openDrawerByF;",
// F038.40 — a search result chosen on another page lands here as /#open=<F>.
"var mOpen=/^#open=(.+)$/.exec(location.hash);if(mOpen){try{openDrawerByF(decodeURIComponent(mOpen[1]));}catch(_){}history.replaceState(null,'',location.pathname+location.search);}",
"})();",
].join("\n");

const fleetPill = (x, cls, pre) => `<span class="fp ${cls}">${pre||""}${x}</span>`;
const fleetCard = (m) => {
  const pubs = (m.pub||[]).map(x=>fleetPill(x,"pub")).join("");
  const srcs = (m.src||[]).map(x=>fleetPill(x,"src","✦ ")).join("");
  const uses = (m.uses||[]).map(x=>fleetPill(x,"use","→ ")).join("");
  const pills = pubs+srcs+uses;
  return `<div class="fc${m.isNew?" isnew":""}"><div class="fc-h"><span class="fs">${m.s}</span>${m.isNew?'<span class="fnew">NEW</span>':""}</div><div class="fr">${m.r}</div>${pills?`<div class="fpills">${pills}</div>`:""}${m.note?`<div class="fnote">${m.note}</div>`:""}</div>`;
};
const fleetHtml = `<section class="fleet">
      <div class="layer-h"><span class="n">FLEET</span><span class="t">Who builds &amp; consumes</span><span class="d">read from every repo's package.json — ${FLEET_SCAN.edges ?? 0} dependencies across ${FLEET_SCAN.repos_scanned ?? 0} repos</span></div>
      <div class="fscan" data-testid="inv-fleet-scanned">${scanLine(FLEET_SCAN)}</div>
      <div class="fgrid">${FLEET_ROWS.map(fleetCard).join("")}</div>
      <div class="flegend"><span class="fp pub">pkg</span> publishes · <span class="fp src">✦ pkg</span> originated the pattern · <span class="fp use">→ pkg</span> consumes</div>
    </section>`;

const infraCard = (p) => {
  const n = (p.tips||[]).length;
  const reg = p.region && p.region!=="—" ? `<div class="icreg">📍 ${p.region}</div>` : "";
  return `<div class="ic" data-f="infra-${p.id}" data-pid="${p.id}" data-testid="inv-infra-${p.id}" role="button" tabindex="0" aria-haspopup="dialog"><div class="ic-h"><span class="icn">${p.name}</span><span class="ictip">${n} tips</span></div><div class="icr">${p.role}</div>${reg}</div>`;
};
const infraChips = `<button class="chip" data-testid="inv-infra-filter-all" data-ip="all" aria-pressed="true">All</button>` +
  INFRA.map(p=>`<button class="chip" data-testid="inv-infra-filter-${p.id}" data-ip="${p.id}">${p.name}</button>`).join("");
const infraHtml = `<section class="infra">
      <div class="layer-h"><span class="n">INFRA</span><span class="t">Best practices</span><span class="d">— the platforms we run on · live tips from the fleet · click a card</span></div>
      <div class="controls"><div class="fil" id="f-infra"><span class="lbl">Platform</span>${infraChips}</div></div>
      <div class="igrid">${INFRA.map(infraCard).join("")}</div>
    </section>`;

// Favicon: scripts/favicon.mjs — one source for every Discovery page (F038.25).

const esc = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── F038.7 — "Just shipped", asked rather than remembered ────────────────────
// This block used to be literal HTML naming @broberg/stripe v0.2.0. It was six
// weeks and four releases out of date, and nothing could have told us: a
// hardcoded value cannot report that it has gone stale.
const newest = releases[0];
const featured = SHIPPED_PKGS.find((it) => it.pkg === newest.pkg);
if (!featured) throw new Error(`newest published package ${newest.pkg} is not in the roster`);

// The version shown is NPM'S, not the roster's — the registry is what a consumer
// installs from, and the two disagreed twice on 2026-08-18 alone.
const FEATURED = {
  name: featured.nm,
  pkg: newest.pkg,
  version: newest.version,
  // Byte-identical to what /ai and llms.txt serve for this package (one definition).
  line: oneLiner(featured),
};

// Report-only, never a silent rewrite: a version is npm's to state, a description
// is the owner's. Both drifts this repo has hit were caught by someone LOOKING.
const drifted = SHIPPED_PKGS
  .map((it) => ({ it, r: releases.find((r) => r.pkg === it.pkg) }))
  .filter(({ it, r }) => r && it.ver !== r.version);
if (drifted.length) {
  console.warn(`\n  ${drifted.length} roster row(s) name a version npm does not serve as latest:`);
  for (const { it, r } of drifted) console.warn(`    ${it.pkg.padEnd(30)} roster ${it.ver}  ->  npm ${r.version}`);
  console.warn("");
}

const HTML = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="${FAVICON}">
<title>@broberg — Component Universe</title>
<style>${CSS}</style>
</head>
<body>
  ${topBar()}
  <div class="wrap">
    <section class="hero">
      <h1><span class="at">The </span>Component Universe</h1>
      <p>The curated shared-component library across the broberg.ai estate — ${total} components across ${DATA.length} layers, best-implementation-per-pattern, extracted into <code>@broberg/*</code> packages. <b>${ship} are live on npm</b> (6 components-owned + sibling SDKs from other repos). Idea → running platform in days. <em>This page renders with the very tokens it documents — click any card to read more.</em></p>
      <div class="stats">
        <div class="stat"><b>${total}</b><span>components</span></div>
        <div class="stat ship"><b>${ship}</b><span>shipped</span></div>
        <div class="stat"><b>${wip}</b><span>under construction</span></div>
        <div class="stat"><b>${grad}</b><span>graduate</span></div>
      </div>
    </section>
    <section class="featured">
      <div>
        <div class="ttl">🆕 Just shipped</div>
        <h2>${esc(FEATURED.name)}</h2>
        <div class="pkg">${esc(FEATURED.pkg)} · v${esc(FEATURED.version)} · ${esc(FEATURED.line)}</div>
      </div>
      <div class="cmd"><span class="p">$</span> npm i ${esc(FEATURED.pkg)}</div>
    </section>
    <div class="controls">
      <div class="fil" id="f-layer"><span class="lbl">Layer</span>${layerChips}</div>
      <div class="fil" id="f-status"><span class="lbl">Status</span><button class="chip" data-testid="inv-filter-status-all" data-s="all" aria-pressed="true">All</button><button class="chip" data-testid="inv-filter-status-shipped" data-s="shipped">✅ Shipped</button><button class="chip" data-testid="inv-filter-status-backlog" data-s="backlog">🚧 Under construction</button></div>
      <div class="fil" id="f-model"><span class="lbl">Model</span><button class="chip" data-testid="inv-filter-model-all" data-mod="all" aria-pressed="true">All</button><button class="chip" data-testid="inv-filter-model-runtime" data-mod="runtime">📦 Runtime</button><button class="chip" data-testid="inv-filter-model-copy" data-mod="copy">📋 Copy-owned</button><button class="chip" data-testid="inv-filter-model-scaffold" data-mod="scaffold">🏗️ Scaffold</button><button class="chip" data-testid="inv-filter-model-hybrid" data-mod="hybrid">🔀 Hybrid</button></div>
      <div class="fil" id="f-grad"><span class="lbl">Show</span><button class="chip" data-testid="inv-filter-grad-all" data-g="all" aria-pressed="true">All</button><button class="chip" data-testid="inv-filter-grad-only" data-g="1"><span class="grad">⬆</span> Graduate only</button></div>
    </div>
    <div class="legend"><span class="b-moved" style="border-radius:6px;padding:1px 7px">↗ moved</span> = re-homed to another repo · everything else is filterable above</div>
    ${layersHtml}
    ${fleetHtml}
    ${infraHtml}
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
        <p><code>F001 @broberg/theme</code> (shipped) is the keystone — it unblocks 8 downstream UI components, and everything visual inherits its tokens. It was the first card built; the rest of L0 (config, mail, media, MCP-toolkit) follows.</p>
      </div>
      <div class="copyright">© 2026 <a href="https://broberg.ai">broberg.ai</a> · Aalborg · Blokhus · Copenhagen · Build &amp; Powered by the broberg.ai universe.</div>
    </footer>
  </div>
  ${SEARCH_MODAL}
  <div class="drawer-backdrop" id="dback" data-testid="inv-detail-backdrop"></div>
  <aside class="drawer" id="drawer" data-testid="inv-detail" role="dialog" aria-modal="true" aria-labelledby="d-name" aria-hidden="true">
    <button class="drawer-x" id="dclose" data-testid="inv-detail-close" aria-label="Close details">✕</button>
    <div id="dbody"></div>
  </aside>
<script>${JS}</script>
<script>${SEARCH_JS}</script>
</body>
</html>
`;
writeFileSync(new URL("../docs/inventory.html", import.meta.url), HTML);
// F038.40 — the same index for ⌘K on every other page (served at /search-index.json).
writeFileSync(new URL("../docs/search-index.json", import.meta.url), JSON.stringify(SEARCH_INDEX) + "\n");
console.log("wrote docs/inventory.html — total=" + total + " shipped=" + ship + " wip=" + wip + " grad=" + grad + " moved=" + mv + " detail-entries=" + Object.keys(DETAIL).length);

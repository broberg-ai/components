// F060 — generate the Discovery onboarding surface from the SINGLE SOURCE
// (inventory-data.mjs). One aggregation → the /onboarding HTML page (here) and
// the /api/onboarding JSON digest (server, once approved). No hand-maintained copy.
//
//   node scripts/build-onboarding.mjs   → writes docs/onboarding.html
import { DATA, INFRA, npmUrl } from "./inventory-data.mjs";
import { writeFileSync } from "node:fs";

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// One-liner = the first sentence of the description (before ". " or " — ").
const oneLiner = (c) => {
  const d = String(c.desc ?? c.nm ?? "").replace(/\s+/g, " ").trim();
  const cut = d.search(/\.\s|\s—\s/);
  const s = cut > 0 ? d.slice(0, cut) : d;
  return s.length > 150 ? s.slice(0, 147) + "…" : s;
};

// ---- aggregation (the SAME shape the /api/onboarding digest will return) ----
const categories = DATA.map((L) => ({
  layer: L.n,
  title: L.t,
  desc: L.d,
  packages: (L.items || [])
    .filter((x) => x.pkg)
    .map((p) => ({
      pkg: p.pkg,
      oneLiner: oneLiner(p),
      version: p.ver || null,
      status: p.s || "planned",
      install: npmUrl ? `npm i ${p.pkg}` : `npm i ${p.pkg}`,
    })),
})).filter((c) => c.packages.length);

const tips = INFRA.filter((p) => (p.tips || []).length).map((p) => ({
  platform: p.name || p.id,
  count: p.tips.length,
  items: p.tips.map((t) => ({ tag: t.tag || "tip", text: t.t, by: t.by || "" })),
}));

const pkgCount = categories.reduce((n, c) => n + c.packages.length, 0);
const tipCount = tips.reduce((n, t) => n + t.count, 0);

// ---- render ----
const tokens = `
:root,[data-theme="dark"]{--bg:oklch(0.211 0 0);--panel:oklch(0.239 0 0);--card:oklch(0.262 0 0);--fg:oklch(0.985 0 0);--muted:oklch(0.66 0 0);--faint:oklch(0.52 0 0);--border:oklch(0.32 0 0);--primary:oklch(0.922 0 0);--primary-fg:oklch(0.205 0 0);--green:oklch(0.74 0.15 152);--amber:oklch(0.80 0.13 80);color-scheme:dark}
[data-theme="light"]{--bg:oklch(0.985 0 0);--panel:oklch(0.97 0 0);--card:oklch(1 0 0);--fg:oklch(0.205 0 0);--muted:oklch(0.5 0 0);--faint:oklch(0.62 0 0);--border:oklch(0.9 0 0);--primary:oklch(0.25 0 0);--primary-fg:oklch(0.985 0 0);--green:oklch(0.52 0.15 152);--amber:oklch(0.58 0.13 70);color-scheme:light}`;

const cardsFor = (c) =>
  c.packages
    .map(
      (p) => `<div class="pk">
      <div class="pk-h"><code>${esc(p.pkg)}</code>${
        p.version
          ? `<span class="v">v${esc(p.version)}</span>`
          : `<span class="v plan">planned</span>`
      }</div>
      <p>${esc(p.oneLiner)}</p></div>`,
    )
    .join("");

const layersHtml = categories
  .map(
    (c) => `<section class="layer" id="cat-${esc(c.layer)}">
    <div class="layer-h"><span class="n">${esc(c.layer)}</span><span class="t">${esc(
      c.title,
    )}</span><span class="d">${esc(c.desc)}</span><span class="ct">${c.packages.length}</span></div>
    <div class="pk-grid">${cardsFor(c)}</div></section>`,
  )
  .join("");

const tipsHtml = tips
  .map(
    (p) => `<section class="plat">
    <h3>${esc(p.platform)}<span class="ct">${p.count}</span></h3>
    <ul class="tips">${p.items
      .map(
        (t) =>
          `<li><span class="tag">${esc(t.tag)}</span><span class="tt">${esc(
            t.text,
          )}</span>${t.by ? `<span class="by">— ${esc(t.by)}</span>` : ""}</li>`,
      )
      .join("")}</ul></section>`,
  )
  .join("");

const catNav = categories
  .map((c) => `<a href="#cat-${esc(c.layer)}">${esc(c.layer)} ${esc(c.title)}</a>`)
  .join("");

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@broberg — Onboarding</title>
<style>
${tokens}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;transition:background .25s,color .25s}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wrap{max-width:1080px;margin:0 auto;padding:0 22px}
.top{position:sticky;top:0;z-index:20;backdrop-filter:blur(12px);background:color-mix(in oklab,var(--bg) 82%,transparent);border-bottom:1px solid var(--border)}
.top .wrap{display:flex;align-items:center;justify-content:space-between;height:56px}
.brand{font-weight:650;letter-spacing:-.01em;font-size:16px}.brand .at{color:var(--faint);font-weight:400}
.tbtn{font:inherit;font-size:12px;font-weight:600;color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:6px 12px;cursor:pointer}
.tbtn:hover{color:var(--fg)}
.hero{padding:52px 0 8px}
.hero h1{font-size:38px;line-height:1.06;font-weight:680;letter-spacing:-.025em;max-width:740px;margin:0}
.hero h1 .at{color:var(--faint);font-weight:400}
.hero p{color:var(--muted);font-size:16px;margin:14px 0 0;max-width:660px}
.hero code{font-size:13px;color:var(--green);background:var(--panel);padding:2px 7px;border-radius:5px}
.stats{display:flex;gap:12px;margin:26px 0 6px;flex-wrap:wrap}
.stat{background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:12px 18px;min-width:92px}
.stat b{display:block;font-size:24px;font-weight:680;line-height:1}.stat.g b{color:var(--green)}
.stat span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-top:5px;display:block}
.agentbar{margin:22px 0 8px;background:linear-gradient(180deg,color-mix(in oklab,var(--green) 8%,var(--panel)),var(--panel));border:1px solid color-mix(in oklab,var(--green) 34%,var(--border));border-radius:14px;padding:16px 20px;display:flex;flex-wrap:wrap;gap:14px;align-items:center}
.agentbar .ttl{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green)}
.agentbar p{margin:3px 0 0;color:var(--muted);font-size:13.5px}
.agentbar .cmd{margin-left:auto;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:10px 14px;font:13px ui-monospace,monospace}
.agentbar .cmd .p{color:var(--faint)}
.jump{display:flex;flex-wrap:wrap;gap:8px;margin:30px 0 6px;padding-bottom:16px;border-bottom:1px solid var(--border)}
.jump a{font-size:12.5px;color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:7px;padding:5px 11px;text-decoration:none}
.jump a:hover{color:var(--fg);border-color:var(--faint)}
h2.sec{font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:44px 0 4px}
.layer{margin-top:26px}
.layer-h{display:flex;align-items:baseline;gap:11px;flex-wrap:wrap;margin-bottom:13px}
.layer-h .n{font:700 12px ui-monospace,monospace;letter-spacing:.1em;color:var(--green);background:color-mix(in oklab,var(--green) 14%,transparent);padding:2px 8px;border-radius:6px}
.layer-h .t{font-size:17px;font-weight:650}.layer-h .d{font-size:13px;color:var(--faint)}
.layer-h .ct{margin-left:auto;font:600 12px ui-monospace,monospace;color:var(--faint)}
.pk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:11px}
.pk{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:13px 15px}
.pk-h{display:flex;align-items:center;gap:9px}
.pk-h code{font-size:13px;font-weight:600;color:var(--fg)}
.pk .v{margin-left:auto;font:600 11px ui-monospace,monospace;color:var(--green);background:color-mix(in oklab,var(--green) 13%,transparent);padding:2px 7px;border-radius:20px}
.pk .v.plan{color:var(--amber);background:color-mix(in oklab,var(--amber) 13%,transparent)}
.pk p{margin:8px 0 0;font-size:13px;color:var(--muted);line-height:1.5}
.plat{margin-top:22px;background:var(--panel);border:1px solid var(--border);border-radius:13px;padding:6px 18px 14px}
.plat h3{display:flex;align-items:center;font-size:15px;font-weight:650;margin:14px 0 4px}
.plat h3 .ct{margin-left:auto;font:600 12px ui-monospace,monospace;color:var(--green)}
.tips{list-style:none;margin:0;padding:0}
.tips li{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:baseline;padding:9px 0;border-top:1px solid var(--border)}
.tips li:first-child{border-top:0}
.tag{font:600 10.5px ui-monospace,monospace;color:var(--amber);background:color-mix(in oklab,var(--amber) 14%,transparent);padding:2px 7px;border-radius:6px;white-space:nowrap}
.tt{font-size:13.5px;color:var(--fg);line-height:1.5}
.by{color:var(--faint);font-size:12px;margin-left:6px}
footer{margin:52px 0 40px;padding-top:22px;border-top:1px solid var(--border);color:var(--faint);font-size:13px}
footer code{color:var(--green)}
footer a{color:var(--muted)}
</style>
</head>
<body>
<header class="top"><div class="wrap"><div class="brand">@broberg <span class="at">· onboarding</span></div>
<button class="tbtn" id="theme">☀ / ☾ theme</button></div></header>
<main class="wrap">
<section class="hero">
  <h1>Start here — the whole shared inventory, <span class="at">in one place.</span></h1>
  <p>Every <code>@broberg/*</code> package by category, and every hard-won tip we've captured. <strong>Reuse&nbsp;&gt;&nbsp;re-roll</strong> — skim this before you wire anything, and enroll when you adopt.</p>
  <div class="stats">
    <div class="stat g"><b>${pkgCount}</b><span>packages</span></div>
    <div class="stat"><b>${categories.length}</b><span>categories</span></div>
    <div class="stat g"><b>${tipCount}</b><span>tips</span></div>
    <div class="stat"><b>${tips.length}</b><span>platforms</span></div>
  </div>
  <div class="agentbar">
    <div><div class="ttl">For agents</div><p>Don't guess a search term — pull the whole map in one call.</p></div>
    <div class="cmd"><span class="p">GET</span> https://discovery.broberg.ai/api/onboarding</div>
  </div>
</section>

<nav class="jump"><a href="#packages">Packages</a><a href="#tips">Tips &amp; tricks</a>${catNav}</nav>

<h2 class="sec" id="packages">Packages by category</h2>
${layersHtml}

<h2 class="sec" id="tips">Tips &amp; tricks — ${tipCount} across ${tips.length} platforms</h2>
${tipsHtml}

<footer>
  Generated from the single source (<code>scripts/inventory-data.mjs</code>) — this page and
  <code>GET /api/onboarding</code> never drift. Adopted a package? Self-report:
  <code>POST /api/onboarding</code> … see <a href="https://discovery.broberg.ai/api">/api</a>.
  Missing something? Build it, then tell <strong>components</strong> so it's added for everyone.
</footer>
</main>
<script>
  var r=document.documentElement,b=document.getElementById("theme");
  b.onclick=function(){r.setAttribute("data-theme",r.getAttribute("data-theme")==="light"?"dark":"light")};
</script>
</body>
</html>`;

writeFileSync(new URL("../docs/onboarding.html", import.meta.url), html);
console.log(`onboarding.html written · ${pkgCount} packages / ${categories.length} categories · ${tipCount} tips / ${tips.length} platforms`);

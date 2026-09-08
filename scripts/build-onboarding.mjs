// F060 — generate the Discovery onboarding surface from the SINGLE SOURCE
// (inventory-data.mjs). One aggregation → the /onboarding HTML page (here) and
// the /llms.txt AI map (llmstxt.org standard) + /llms-full.txt. No hand-maintained copy.
//
//   node scripts/build-onboarding.mjs   → writes docs/onboarding.html
import { DATA, INFRA, npmUrl, oneLiner } from "./inventory-data.mjs";
import { writeFileSync } from "node:fs";

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// One-liner now lives in inventory-data.mjs (F038.7) — the "Just shipped"
// hero card must serve the identical string, so there is exactly one definition.

// F038.15 — the LONG form, for /llms-full.txt. Same source field as oneLiner(),
// with no truncation at all: whitespace collapsed so a whole description sits on
// one markdown line, and nothing is cut. `oneLiner` is deliberately untouched —
// the defect was never that the short form was wrong, it was that NOTHING served
// the long one to the audience our own CLAUDE.md sends here first.
const fullDesc = (c) => String(c.desc ?? c.nm ?? "").replace(/\s+/g, " ").trim();

// ---- aggregation (also feeds the /llms.txt map) ----
const categories = DATA.map((L) => ({
  layer: L.n,
  title: L.t,
  desc: L.d,
  packages: (L.items || [])
    .filter((x) => x.pkg)
    .map((p) => ({
      pkg: p.pkg,
      oneLiner: oneLiner(p),
      desc: fullDesc(p),
      version: p.ver || null,
      status: p.s || "planned",
      install: npmUrl ? `npm i ${p.pkg}` : `npm i ${p.pkg}`,
    })),
})).filter((c) => c.packages.length);

// F038.17 — the rows `.filter((x) => x.pkg)` above drops. Measured 2026-09-08:
// 17 of 71, and ZERO of them reached /llms.txt — the surface CLAUDE.md orders
// every session to read FIRST, before wiring any cross-cutting capability. So
// the one page whose job is answering "do we already have something that does
// X?" was answering only the npm-shaped quarter of the question.
//
// They are NOT rendered like packages, and that is the whole design. 15 of the
// 17 are `planned` — they do not exist. A row that reads like something you can
// use, for something that does not exist, is the webpush precedent and is worse
// than the silence it replaces. So: THREE STATES, never two.
const nonPkg = DATA.flatMap((L) =>
  (L.items || [])
    .filter((x) => !x.pkg)
    .map((r) => ({
      id: r.f,
      name: r.nm,
      layer: L.n,
      status: r.s || "planned",
      owner: r.own || "unassigned",
      oneLiner: oneLiner(r),
      desc: fullDesc(r),
    })),
);
const nonPkgShipped = nonPkg.filter((r) => r.status === "shipped");
const nonPkgFuture = nonPkg.filter((r) => r.status !== "shipped");

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

// F038.17 — the same three states on the HUMAN page. Caught by the review gate:
// the first cut of this card fixed /llms.txt and /llms-full.txt and left
// /onboarding showing 0 of 17, even though the plan-doc named it. The AC was
// written narrower than the defect it described.
const nonPkgCards = (rows, planned) =>
  rows
    .map(
      (r) => `<div class="pk">
      <div class="pk-h"><code>${esc(r.name)}</code><span class="v${
        planned ? " plan" : ""
      }">${planned ? "not built yet" : "not on npm"}</span></div>
      <p>${esc(r.oneLiner)}</p>
      <p class="own">${esc(r.layer)} · owner: ${esc(r.owner)}${
        planned ? " — ask them before building a second one" : " — you call it, nothing to install"
      }</p></div>`,
    )
    .join("");

const nonPkgHtml = `
<h2 class="sec" id="notnpm">Shipped, but not an npm package (${nonPkgShipped.length})</h2>
<section class="layer"><div class="pk-grid">${nonPkgCards(nonPkgShipped, false)}</div></section>

<h2 class="sec" id="planned">Planned — not built yet (${nonPkgFuture.length})</h2>
<section class="layer"><div class="layer-h"><span class="t">None of these exist</span><span class="d">listed so you do not conclude the fleet has nothing and quietly build a second one</span><span class="ct">${nonPkgFuture.length}</span></div>
<div class="pk-grid">${nonPkgCards(nonPkgFuture, true)}</div></section>`;

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
.pk .own{color:var(--faint);font-size:12px;margin-top:6px}
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
    <div><div class="ttl">For agents</div><p>Don't guess a search term — fetch the whole map as one markdown file (the llms.txt standard).</p></div>
    <div class="cmd"><span class="p">GET</span> https://discovery.broberg.ai/llms.txt</div>
  </div>
</section>

<nav class="jump"><a href="#packages">Packages</a><a href="#notnpm">Not on npm</a><a href="#planned">Planned</a><a href="#tips">Tips &amp; tricks</a>${catNav}</nav>

<h2 class="sec" id="packages">Packages by category</h2>
${layersHtml}

${nonPkgHtml}

<h2 class="sec" id="tips">Tips &amp; tricks — ${tipCount} across ${tips.length} platforms</h2>
${tipsHtml}

<footer>
  Generated from the single source (<code>scripts/inventory-data.mjs</code>) — this page and
  <code>GET /llms.txt</code> never drift. Adopted a package? Self-report:
  <code>POST /api/enroll</code> … see <a href="https://discovery.broberg.ai/api">/api</a>.
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

// ---- llms.txt (llmstxt.org standard) — the AI-discoverable markdown map ----
const BASE = "https://discovery.broberg.ai";

// F038.15 — THE TWO FILES MUST SAY WHAT THEY ARE, and each must point at the
// other. Until today `llms-full.txt` was written from the same string as
// `llms.txt` and the pointer line here advertised it as "every tip inline" —
// which llms.txt ALREADY was, so the one line telling a reader to fetch the full
// file described a difference that did not exist. A reader following it exactly
// had no reason to go, and nothing to find if they did.
const preambleFor = (isFull) => `# broberg.ai shared inventory — @broberg/* packages + fleet tips

> You are an AI coding assistant. A developer pointed you here because they are starting or
> extending a project in the **broberg.ai** fleet. **Rule: reuse before you build** — every
> cross-cutting capability (mail, auth, storage, web-push, LLM access, design tokens, cron, …)
> already has a shared \`@broberg/*\` package. Skim this file top to bottom, consume what fits
> (exact-pin production deps), and tell the \`components\` session if something is missing so it
> lands for everyone. Human page: ${BASE}/onboarding · JSON API: ${BASE}/api

## Using the inventory
- Found it? \`npm i @broberg/<name>\`. Missing it? Build it, then tell \`components\`.
- Enroll when you adopt: \`POST ${BASE}/api/enroll\` (trust-on-first-use key; see ${BASE}/api).
- All ${tipCount} tips are inline below, in full. That part needs no second fetch.
${
  isFull
    ? `- **Package descriptions here are COMPLETE** — every sentence we have written about each package, including what was learned after the first one. The short map, one line per package, is at ${BASE}/llms.txt.`
    : `- **Package descriptions here are ONE-LINERS** — the first sentence only. Anything learned about a package after that sentence (a caveat, a sub-path, a "this is NOT in this package") is at ${BASE}/llms-full.txt. Fetch it before you decide a capability is missing.`
}
`;

const pkgLines = (c) =>
  c.packages
    .map(
      (p) =>
        `- **${p.pkg}**${p.version ? ` v${p.version}` : " (planned)"} — ${p.oneLiner}. \`npm i ${p.pkg}\``,
    )
    .join("\n");
const pkgMd = categories
  .map((c) => `### ${c.layer} — ${c.title} (${c.desc})\n${pkgLines(c)}`)
  .join("\n\n");

// F038.15 — the same rows, with the WHOLE description. Install command on the
// header line so the paragraph underneath is the description and nothing else.
const pkgFullLines = (c) =>
  c.packages
    .map(
      (p) =>
        `- **${p.pkg}**${p.version ? ` v${p.version}` : " (planned)"} · \`npm i ${p.pkg}\`\n  ${p.desc}`,
    )
    .join("\n");
const pkgFullMd = categories
  .map((c) => `### ${c.layer} — ${c.title} (${c.desc})\n${pkgFullLines(c)}`)
  .join("\n\n");
const tipsFullMd = tips
  .map(
    (t) =>
      `### ${t.platform} (${t.count})\n` +
      t.items.map((it) => `- **[${it.tag}]** ${it.text}${it.by ? ` _(${it.by})_` : ""}`).join("\n"),
  )
  .join("\n\n");

// Secrets Vault house-rule — mirrored BYTE-IDENTICAL from cardmem's canonical
// CLAUDE.md scaffolding-master section (broberg-ai/cardmem @ 67d6b67, F214.8) so
// /ai and every enrolled repo's CLAUDE.md carry the exact same fleet directive.
// Christian's dictated sentence is the load-bearing line.
const secretsVaultMd = [
  "## Secrets Vault — flådens delte krypterede secret-store",
  "",
  "> **Canonical section per F057 multi-project convention.** Copied into every enrolled repo. cardmems Secrets Vault er **vores alles unikke, delte vault til secrets** — én krypteret opbevaringsplads for hele flåden, ikke pr. maskine.",
  "",
  "**Hvis du har nogle secrets, så gem dem i din secrets vault via cardmem MCP.** En loss-risk-nøgle (Apple `.p8`, en mint-secret, en enroll-key, et provider-token) må aldrig kun ligge i én gitignored fil på én Mac — så forsvinder den når konteksten komprimeres eller maskinen skiftes. Læg den i vaulten, så overlever den, er auditeret, og enhver fleet-session kan hente den igen på dens id.",
  "",
  "Vaulten **erstatter ikke `.env`** — `.env` er stadig helt fint til lokal dev. Vaulten er den durable, delte, krypterede hjem OVENPÅ det: den ene kilde en secret altid kan genfindes fra.",
  "",
  "**Sådan (per-projekt, AES-256-GCM, auditeret, blokeret for den read-only Lens-principal):**",
  "- **Gem:** `cardmem_create_secret({ project, name, value, type?, env_var_name? })` — skriv-halvdelen. Multiline virker (en PEM / Apple `.p8` med newlines round-tripper). `type` auto-detekteres. Returnerer kun `{ id, name, type, preview }` — **aldrig** værdien.",
  "- **Hent:** `cardmem_get_secret({ secret_id })` → plaintext på id, så du kan skrive den i `.env` / `flyctl secrets set` / `gh secret set`. Auditeret.",
  "- **List (metadata):** `cardmem_list_secrets({ project })` → id, navn, type, maskeret preview — aldrig en værdi.",
  "- **Kortlæg env-var:** `cardmem_set_secret_env_name({ secret_id, env_var_name })`. Eller brug UI'et: **Settings → Secrets**.",
  "",
  "**Aldrig** paste en secret-værdi over intercom/chat/argv eller ind i en LLM-kontekst — `cardmem_create_secret` tager værdien server-side og returnerer kun id + maskeret preview. Læs værdien fra en gitignored fil ind i et script, send den over HTTPS, print kun id/preview.",
].join("\n");

// TWO FILES, TWO JOBS (F038.15). Both carry every tip inline; they differ in how
// much of each package they carry.
//
//   llms.txt       the MAP. One line per package, so the whole shelf fits in one
//                  read and a session can see WHAT exists before spending on it.
//   llms-full.txt  the WHOLE TEXT. Every sentence of every description.
//
// These used to be the same string, written twice — 67,393 bytes each, `cmp`
// byte-identical — with a comment calling the second "a convention alias for the
// same content". So a capability described in sentence four reached nobody: the
// dashboard HTML and the JSON API had it, and those are exactly the "further
// link" the fleet's own CLAUDE.md promises there is none of. The precedent is on
// the books one level down — cms-inline-edit grew a page-link resolver that lived
// past the first sentence, and the fix then was to rewrite that ONE row's opening
// segment. That works once. There are 54 rows.
//
// scripts/check-llms-full.mjs is the gate that keeps them apart; it runs in the
// `check` job that the Discovery deploy needs, so a re-alias cannot ship.
// Shipped and real, just not installable — you CALL it, so there is no `npm i`.
const shippedNonPkgMd = (isFull) =>
  nonPkgShipped
    .map(
      (r) =>
        `- **${r.name}** (${r.layer}) · NOT AN NPM PACKAGE — you call it, there is nothing to install · owner: ${r.owner}\n  ${isFull ? r.desc : r.oneLiner}`,
    )
    .join("\n");

// The marker sits on the SAME LINE as the name, deliberately: a reader who skims
// one line must not be able to mistake a plan for a capability.
const futureNonPkgMd = (isFull) =>
  nonPkgFuture
    .map(
      (r) =>
        `- **${r.name}** (${r.layer}) · ⛔ NOT BUILT YET (${r.status}) — nothing to install, nothing to import · owner: ${r.owner} — ASK THEM before building a second one\n  ${isFull ? r.desc : r.oneLiner}`,
    )
    .join("\n");

const body = (packagesMd, heading, isFull) => `${secretsVaultMd}

## Packages by category (${pkgCount})${heading}

${packagesMd}

## Shipped, but NOT an npm package (${nonPkgShipped.length})

These are real and usable TODAY. There is no \`npm i\` — you call them or you copy
them — so a grep for a package name will never find them.

${shippedNonPkgMd(isFull)}

## Planned — NOT BUILT YET (${nonPkgFuture.length})

**None of these exist.** They are on the map so you do not conclude the fleet has
nothing and quietly build a second one. If one is what you need: talk to the
owner. That conversation is the whole point of this inventory.

${futureNonPkgMd(isFull)}

## Tips & tricks — every tip inline (${tipCount} across ${tips.length} platforms)

${tipsFullMd}
`;

const llms = `${preambleFor(false)}\n${body(pkgMd, "", false)}`;
const llmsFull = `${preambleFor(true)}\n${body(pkgFullMd, " — complete descriptions", true)}`;

writeFileSync(new URL("../docs/llms.txt", import.meta.url), llms);
writeFileSync(new URL("../docs/llms-full.txt", import.meta.url), llmsFull);

console.log(
  `onboarding.html + llms.txt (${llms.length}b) + llms-full.txt (${llmsFull.length}b) written · ` +
    `${pkgCount} packages / ${categories.length} categories · ${tipCount} tips / ${tips.length} platforms`,
);

// F038.35 — one page per @broberg package: everything Discovery knows, and who
// in the fleet installs it. Christian 23/10 2026: «en pakke side hvor ALLE data
// vises samt hvem der anvender pakken i vores fleet». No new data source: the
// roster, docs/npm-meta.json, data/dependency-health.json, the fleet scan and
// the enrollments — each section says which one it comes from.
import { SITE_CSS, topBar, THEME_JS, SEARCH_MODAL, SEARCH_JS, tagLinks } from "../../scripts/site-chrome.mjs";
import { FAVICON } from "../../scripts/favicon.mjs";
import { daTime, PROVENANCE_LABEL } from "../../scripts/npm-meta.mjs";
import { REPO_SESSION } from "../../scripts/fleet-graph.mjs";

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Sev = { critical: number; high: number; moderate: number; low: number };
export interface DetailPackage {
  name: string;
  version: string | null;
  install: string;
  description: string | null;
  /** F038.36 — one short human sentence from the roster (`sum`). */
  summary: string | null;
  layer: string | null;
  layerName: string | null;
  component: string | null;
  componentName: string | null;
  model: string | null;
  modelDesc: string | null;
  status: string | null;
  owner: string | null;
  graduate: boolean;
  note: string | null;
  keywords: string[];
  npmUrl: string | null;
  repoUrl: string | null;
  publishedAt: string | null;
  provenance: "yes" | "no" | "unknown";
}
export interface DetailDeps {
  verdict: string;
  status?: string;
  error?: string;
  prod: Sev;
  peer?: Sev;
  dev?: Sev;
  outdated?: { total: number; shipped: number; deprecated: number };
  checkedAt: string;
}
export interface ConsumerUse { range: string; field: string; at: string }
export interface Consumer { repo: string; session: string; uses: ConsumerUse[] }
export interface Enrolled { session: string; version: string; role: string; commit: string | null; notes: string | null; updated_at: number }
export interface ScanState { scannedAt: string | null; stale: boolean; reposScanned: number; reposFailed: number }

/** Every repo in the fleet scan whose manifests name `pkg` — with WHERE and at
 *  WHAT range, not just the repo name. Same set as consumersOf(), richer rows. */
export function consumerDetails(scan: { repos?: Record<string, { error?: string; deps?: Record<string, ConsumerUse[]> }> }, pkg: string): Consumer[] {
  const out: Consumer[] = [];
  for (const [repo, r] of Object.entries(scan?.repos ?? {})) {
    if (r.error) continue;
    const uses = r.deps?.[pkg];
    if (!uses) continue;
    out.push({ repo, session: (REPO_SESSION as Record<string, string>)[repo] ?? repo, uses: uses.map((u) => ({ range: u.range, field: u.field, at: u.at })) });
  }
  return out.sort((a, b) => a.session.localeCompare(b.session));
}


/** F038.36 — «3 dage og 5 timer siden». Computed per request so it never stands still. */
export function ageText(iso: string | null, now = Date.now()): string | null {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return null;
  const hours = Math.floor(Math.max(0, now - t) / 3.6e6);
  if (hours < 1) return "under en time siden";
  const d = Math.floor(hours / 24), h = hours % 24;
  const dd = d ? `${d} ${d === 1 ? "dag" : "dage"}` : "";
  const hh = h ? `${h} ${h === 1 ? "time" : "timer"}` : "";
  return `${[dd, hh].filter(Boolean).join(" og ")} siden`;
}

const CODE = /(@[\w-]+\/[\w-]+(?:[.\/][\w-]+)*|\b[A-Za-z_$][\w$.]*\([^()\s]{0,40}\)|\bF\d+(?:\.\d+)+\b|\bF\d{2,}\b|(?<![\w-])--[\w-]+|\b[\w.-]+\/[\w./-]+\.(?:ts|tsx|js|mjs|json|md|toml|yml|yaml|css|html)\b)/g;
const NEW_PARA = /^(?:v?\d+\.\d+(?:\.\d+)?\b|Shipped|DELIVERED|Since|Udgives|THE |WHY |NOT |Measured|Målt)/;

/** F038.36 — the roster description is written for agents: one long block. Break it
 *  into paragraphs (at version/change markers, else every 3 sentences) and mark the
 *  code-shaped words, so a human can read it. Escapes BEFORE marking. */
export function formatDescription(text: string): string {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-ZÆØÅ0-9«"(@v])/);
  const paras: string[][] = [];
  for (const sen of sentences) {
    const cur = paras[paras.length - 1];
    if (!cur || cur.length >= 3 || NEW_PARA.test(sen)) paras.push([sen]);
    else cur.push(sen);
  }
  return paras.map((p) => `<p>${esc(p.join(" ")).replace(CODE, "<code>$1</code>")}</p>`).join("");
}

const UNKNOWN = "ukendt";
const val = (v: unknown, empty = UNKNOWN) => (v == null || v === "" ? `<span class="pd-none">${esc(empty)}</span>` : esc(v));
const sev = (s?: Sev) => (s ? `kritisk ${s.critical} · høj ${s.high} · middel ${s.moderate} · lav ${s.low}` : null);

const PAGE_CSS = `
  .pd-back{display:inline-block;margin:28px 0 0;color:var(--muted);text-decoration:none;font-size:13.5px}
  .pd-back:hover{color:var(--fg)}
  .pd-sec{margin:34px 0 0}
  .pd-sec h2{font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:0 0 10px}
  .pd-src{font-size:12px;color:var(--faint);font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px}
  .pd-dl{display:grid;grid-template-columns:200px minmax(0,1fr);gap:0;border-top:1px solid var(--border);margin:0}
  .pd-dl dt,.pd-dl dd{margin:0;padding:10px 12px;border-bottom:1px solid var(--border);font-size:14px;min-width:0;overflow-wrap:anywhere}
  .pd-dl dt{color:var(--muted)}
  .pd-dl a,.pd-t a{color:var(--green);text-decoration:none;font-weight:600}
  .pd-dl a:hover,.pd-t a:hover{text-decoration:underline}
  .pd-dl code,.pd-t code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
  .pd-none{color:var(--faint);font-style:italic}
  .pd-ok{color:var(--green)} .pd-warn{color:var(--amber)} .pd-bad{color:var(--amber);font-weight:700}
  .pd-t{width:100%;border-collapse:collapse;font-size:13.5px}
  .pd-t th{text-align:left;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding:10px 12px;border-bottom:1px solid var(--border)}
  .pd-t td{padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top}
  .hero h1,.hero p{overflow-wrap:anywhere;min-width:0}
  .hero .pd-summary{font-size:19px;line-height:1.5;color:var(--fg);max-width:62ch;margin:10px 0 6px}
  .hero .pd-meta{font-size:13.5px;color:var(--muted);margin:0}
  .pd-toggle{display:inline-flex;align-items:center;gap:8px;font:inherit;font-size:14px;font-weight:600;color:var(--fg);background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:9px 14px;cursor:pointer;transition:border-color .15s,background .15s}
  .pd-toggle:hover{border-color:var(--muted)}
  .pd-toggle:active{transform:translateY(1px)}
  .pd-toggle:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
  .pd-chev{width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);transition:transform .15s}
  .pd-toggle[aria-expanded="true"] .pd-chev{transform:rotate(45deg)}
  .pd-desc{max-width:72ch;margin:16px 0 0;padding:18px 22px;background:var(--panel);border:1px solid var(--border);border-radius:12px}
  .pd-desc p{margin:0 0 12px;font-size:15px;line-height:1.65;color:var(--fg);overflow-wrap:anywhere}
  .pd-desc p:last-child{margin-bottom:0}
  .pd-desc code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg);background:var(--card);border:1px solid var(--border);border-radius:5px;padding:0 4px}
  .pd-empty{padding:22px;border:1px dashed var(--border);border-radius:12px;color:var(--muted)}
  .pd-wrap{overflow-x:auto;margin-bottom:60px}
  @media (max-width:640px){.pd-dl{grid-template-columns:minmax(0,1fr)}.pd-dl dt{border-bottom:0;padding-bottom:0}}
`;

const page = (title: string, body: string) =>
  `<!doctype html><html lang="da" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="${FAVICON}"><title>${esc(title)} — Discovery</title>
<style>${SITE_CSS}${PAGE_CSS}</style></head>
<body>${topBar({ active: "/packages" })}
<div class="wrap">${body}</div>
<script>(function(){${THEME_JS}})();(function(){var b=document.querySelector('[data-testid="pkg-detail-desc-toggle"]');if(!b)return;var d=document.getElementById('pkg-detail-desc'),l=b.querySelector('.pd-toggle-label');b.addEventListener('click',function(){var open=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(open));d.hidden=!open;l.textContent=open?'Skjul fuld beskrivelse':'Vis fuld beskrivelse';});})();</script>
${SEARCH_MODAL}
<script>${SEARCH_JS}</script></body></html>`;

export function renderPackageNotFound(name: string): string {
  return page("Ukendt pakke", `<main data-testid="pkg-detail-notfound"><a class="pd-back" href="/packages" data-testid="pkg-detail-back">← Alle pakker</a><section class="hero"><h1>Ukendt pakke</h1><p><code>${esc(name)}</code> er ikke en udgivet <code>@broberg</code>-pakke i Discovery.</p></section></main>`);
}

export function renderPackageDetail(p: DetailPackage, deps: DetailDeps | null, consumers: Consumer[], enrolled: Enrolled[], scan: ScanState, now = Date.now()): string {
  const rows: [string, string][] = [
    ["Version", val(p.version)],
    ["Installér", `<code>${esc(p.install)}</code>`],
    ["npm", p.npmUrl ? `<a href="${esc(p.npmUrl)}" target="_blank" rel="noopener" data-testid="pkg-detail-npm">${esc(p.npmUrl)} ↗</a>` : val(null, "ingen")],
    ["Udgivet", val(daTime(p.publishedAt))],
    ["Sidst opdateret", `<span data-testid="pkg-detail-age">${val(ageText(p.publishedAt, now))}</span>`],
    ["Trusted Publisher", `<span class="${p.provenance === "yes" ? "pd-ok" : "pd-warn"}">${esc(PROVENANCE_LABEL[p.provenance])}</span>`],
    ["Kilde-repo", p.repoUrl ? `<a href="${esc(p.repoUrl)}" target="_blank" rel="noopener" data-testid="pkg-detail-repo">${esc(p.repoUrl)} ↗</a>` : val(null, "ikke offentligt")],
    ["Lag", p.layer ? `${esc(p.layer)}${p.layerName ? ` · ${esc(p.layerName)}` : ""}` : val(null)],
    ["Komponent", p.component ? `${esc(p.component)}${p.componentName ? ` · ${esc(p.componentName)}` : ""}` : val(null)],
    ["Model", p.model ? `${esc(p.model)}${p.modelDesc ? ` · ${esc(p.modelDesc)}` : ""}` : val(null)],
    ["Status", val(p.status)],
    ["Ejer", val(p.owner)],
    ["Graduate", p.graduate ? "ja" : "nej"],
    ["Nøgleord", p.keywords.length ? tagLinks(p.keywords, "pkg-tag-") : val(null, "ingen")],
    ["Note", val(p.note, "ingen")],
  ];
  const overview = `<dl class="pd-dl" data-testid="pkg-detail-overview">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd data-field="${esc(k)}">${v}</dd>`).join("")}</dl>`;

  const depBlock = !deps
    ? `<p class="pd-empty" data-testid="pkg-detail-deps">Ikke tjekket endnu — pakken er ikke med i det daglige afhængigheds-tjek.</p>`
    : `<dl class="pd-dl" data-testid="pkg-detail-deps">` +
      `<dt>Resultat</dt><dd data-field="verdict" class="${deps.verdict === "OK" ? "pd-ok" : deps.verdict === "sårbar" ? "pd-bad" : "pd-warn"}">${esc(deps.verdict)}${deps.error ? ` — ${esc(deps.error)}` : ""}</dd>` +
      `<dt>Leveres til apps</dt><dd>${val(sev(deps.prod))}</dd>` +
      `<dt>Via peer (appens egen)</dt><dd>${val(sev(deps.peer), "ikke målt")}</dd>` +
      `<dt>Kun udvikling</dt><dd>${val(sev(deps.dev), "ikke målt")}</dd>` +
      `<dt>Forældede</dt><dd>${deps.outdated ? `${deps.outdated.total} (heraf leveret ${deps.outdated.shipped}, udfasede ${deps.outdated.deprecated})` : val(null, "ikke målt")}</dd>` +
      `<dt>Tjekket</dt><dd>${val(daTime(deps.checkedAt))}</dd></dl>`;

  const scanNote = scan.scannedAt ? `scannet ${esc(daTime(scan.scannedAt))}${scan.stale ? " — FORÆLDET" : ""} · ${scan.reposScanned} repoer${scan.reposFailed ? `, ${scan.reposFailed} kunne ikke læses` : ""}` : "flåde-scannet mangler";
  const consumerBlock = consumers.length
    ? `<div class="pd-wrap"><table class="pd-t" data-testid="pkg-detail-consumers"><thead><tr><th>Repo</th><th>Session</th><th>Version</th><th>Felt</th><th>Hvor</th></tr></thead><tbody>` +
      consumers.flatMap((c, i) => c.uses.map((u, j) => `<tr data-testid="pkg-detail-consumer-${i}" data-repo="${esc(c.repo)}">${j === 0 ? `<td rowspan="${c.uses.length}"><code>${esc(c.repo)}</code></td><td rowspan="${c.uses.length}">${c.session === c.repo ? val(null, "ingen session") : esc(c.session)}</td>` : ""}<td><code>${esc(u.range)}</code></td><td>${esc(u.field)}</td><td><code>${esc(u.at)}</code></td></tr>`)).join("") +
      `</tbody></table></div>`
    : !scan.scannedAt || scan.stale
      ? `<p class="pd-empty pd-warn" data-testid="pkg-detail-consumers-empty" data-reason="no-scan">Ingen forbrugere fundet — men flåde-scannet ${scan.scannedAt ? "er forældet" : "mangler"}, så det er ikke et svar på om nogen bruger pakken.</p>`
      : `<p class="pd-empty" data-testid="pkg-detail-consumers-empty" data-reason="none">Ingen repo i flåden installerer pakken (${scanNote}).</p>`;

  const enrolledBlock = enrolled.length
    ? `<div class="pd-wrap"><table class="pd-t" data-testid="pkg-detail-enrolled"><thead><tr><th>Session</th><th>Version</th><th>Rolle</th><th>Commit</th><th>Noter</th><th>Meldt</th></tr></thead><tbody>` +
      enrolled.map((e) => `<tr><td>${esc(e.session)}</td><td><code>${esc(e.version)}</code></td><td>${e.role === "src" ? "oprindelse" : "bruger"}</td><td>${e.commit ? `<code>${esc(e.commit.slice(0, 8))}</code>` : val(null, "–")}</td><td>${val(e.notes, "–")}</td><td>${esc(daTime(new Date(e.updated_at).toISOString()))}</td></tr>`).join("") +
      `</tbody></table></div>`
    : `<p class="pd-empty" data-testid="pkg-detail-enrolled-empty">Ingen session har selv meldt at de bruger pakken.</p>`;

  const body = `<main data-testid="pkg-detail-root" data-name="${esc(p.name)}"><a class="pd-back" href="/packages" data-testid="pkg-detail-back">← Alle pakker</a>
<section class="hero"><h1>${esc(p.name)}</h1><p class="pd-summary" data-testid="pkg-detail-summary">${val(p.summary, "intet resumé endnu")}</p><p class="pd-meta">${esc(p.version ? `v${p.version}` : "")}${p.layerName ? ` · ${esc(p.layerName)}` : ""} · bruges af ${consumers.length} repo${consumers.length === 1 ? "" : "er"} i flåden</p></section>
<section class="pd-sec"><h2>Beskrivelse<span class="pd-src">fuld, teknisk</span></h2>${p.description
    ? `<button type="button" class="pd-toggle" aria-expanded="false" aria-controls="pkg-detail-desc" data-testid="pkg-detail-desc-toggle"><span class="pd-chev" aria-hidden="true"></span><span class="pd-toggle-label">Vis fuld beskrivelse</span></button><div class="pd-desc" id="pkg-detail-desc" data-testid="pkg-detail-desc" hidden>${formatDescription(p.description)}</div>`
    : `<p class="pd-empty">${val(null, "ingen beskrivelse")}</p>`}</section>
<section class="pd-sec"><h2>Oversigt<span class="pd-src">roster + npm</span></h2>${overview}</section>
<section class="pd-sec"><h2>Afhængigheds-tjek<span class="pd-src">dagligt, pnpm audit + OSV.dev, data/dependency-health.json</span></h2>${depBlock}</section>
<section class="pd-sec"><h2>Bruges i flåden (${consumers.length})<span class="pd-src">flåde-scan · ${scanNote}</span></h2>${consumerBlock}</section>
<section class="pd-sec"><h2>Selv-rapporteret (${enrolled.length})<span class="pd-src">Discovery-enrollments</span></h2>${enrolledBlock}</section>
</main>`;
  return page(p.name, body);
}

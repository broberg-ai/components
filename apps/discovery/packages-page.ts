// F038.32 — «Packages»: every published @broberg package on one sortable page.
// All data comes from sources that already exist: the roster (/api/packages),
// docs/npm-meta.json (F038.31) and the fleet scan (F083). Nothing hand-written.
import { SITE_CSS, topBar, THEME_JS } from "../../scripts/site-chrome.mjs";
import { FAVICON } from "../../scripts/favicon.mjs";
import { daTime, PROVENANCE_LABEL } from "../../scripts/npm-meta.mjs";

export interface PackageRow {
  name: string;
  version: string | null;
  npmUrl: string | null;
  publishedAt: string | null;
  provenance: "yes" | "no" | "unknown";
  layer: string | null;
  owner: string | null;
  install: string;
  consumers: string[];
  /** F082.5 — from data/dependency-health.json; null = never checked. */
  deps: { verdict: string; prod: { critical: number; high: number; moderate: number; low: number }; checkedAt: string } | null;
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sortable columns: key → header label. Order is the column order. */
export const COLUMNS: [string, string][] = [
  ["name", "Pakke"],
  ["version", "Version"],
  ["published", "Udgivet"],
  ["provenance", "Trusted Publisher"],
  ["layer", "Lag"],
  ["owner", "Ejer"],
  ["consumers", "Bruges af"],
  ["deps", "Afhængigheder"],
];

const PAGE_CSS = `
  .pk-table{width:100%;border-collapse:collapse;margin:22px 0 60px;font-size:13.5px}
  .pk-table th{text-align:left;padding:0;border-bottom:1px solid var(--border)}
  .pk-table th button{font:inherit;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;background:none;border:0;padding:10px 12px;cursor:pointer;width:100%;text-align:left}
  .pk-table th button:hover{color:var(--fg)}
  .pk-table th button:active{opacity:.7}
  .pk-table th button[aria-sort="ascending"]::after{content:" ▲"}
  .pk-table th button[aria-sort="descending"]::after{content:" ▼"}
  .pk-table td{padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top}
  .pk-table tr:hover td{background:var(--panel)}
  .pk-table a{color:var(--green);font-weight:600;text-decoration:none}
  .pk-table a:hover{text-decoration:underline}
  .pk-table code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
  .pk-yes,.pk-dep-ok{color:var(--green)} .pk-no,.pk-unknown,.pk-dep-minor,.pk-dep-unknown{color:var(--amber)}
  .pk-dep-bad{color:var(--amber);font-weight:700}
  .pk-wrap{overflow-x:auto}
`;

function depClass(d: PackageRow["deps"]): string {
  if (!d) return "unknown";
  return d.verdict === "OK" ? "ok" : d.verdict === "sårbar" ? "bad" : d.verdict === "mindre fund" ? "minor" : "unknown";
}
export function depText(d: PackageRow["deps"]): string {
  if (!d) return "ikke tjekket";
  const p = d.prod;
  return d.verdict === "sårbar" || d.verdict === "mindre fund" ? `${d.verdict} (kritisk ${p.critical} · høj ${p.high} · middel ${p.moderate})` : d.verdict;
}
/** Sort key: worst first when descending. */
function depRank(d: PackageRow["deps"]): string {
  if (!d) return "1";
  return d.verdict === "sårbar" ? `3-${String(d.prod.critical).padStart(3, "0")}-${String(d.prod.high).padStart(3, "0")}` : d.verdict === "mindre fund" ? "2" : d.verdict === "OK" ? "0" : "1";
}

export function renderPackagesPage(rows: PackageRow[], scannedAt: string | null): string {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const body = sorted
    .map((r, i) => {
      const when = daTime(r.publishedAt);
      return `<tr data-testid="pkg-row-${i}" data-name="${esc(r.name)}" data-version="${esc(r.version)}" data-published="${esc(r.publishedAt ?? "")}" data-provenance="${esc(r.provenance)}" data-layer="${esc(r.layer)}" data-owner="${esc(r.owner)}" data-consumers="${r.consumers.length}" data-deps="${esc(depRank(r.deps))}">` +
        `<td>${r.npmUrl ? `<a href="${esc(r.npmUrl)}" target="_blank" rel="noopener" data-testid="pkg-npm-${i}">${esc(r.name)} ↗</a>` : esc(r.name)}<br><code>${esc(r.install)}</code></td>` +
        `<td>${esc(r.version ?? "—")}</td>` +
        `<td>${esc(when ?? "ukendt")}</td>` +
        `<td class="pk-${esc(r.provenance)}">${esc(PROVENANCE_LABEL[r.provenance])}</td>` +
        `<td>${esc(r.layer ?? "—")}</td>` +
        `<td>${esc(r.owner ?? "—")}</td>` +
        `<td title="${esc(r.consumers.join(", "))}">${r.consumers.length}</td>` +
        `<td class="pk-dep-${depClass(r.deps)}" data-testid="pkg-deps-${i}" title="${esc(r.deps ? `tjekket ${daTime(r.deps.checkedAt) ?? "?"}` : "aldrig tjekket")}">${esc(depText(r.deps))}</td></tr>`;
    })
    .join("");
  const head = COLUMNS.map(([k, label]) => `<th><button type="button" data-key="${k}" data-testid="pkg-sort-${k}">${label}</button></th>`).join("");
  const tp = rows.filter((r) => r.provenance === "yes").length;
  const vulnerable = rows.filter((r) => r.deps?.verdict === "sårbar").length;
  const scanned = daTime(scannedAt);
  const sortJs = `(function(){var t=document.querySelector('[data-testid="pkg-table"] tbody');var num={consumers:1};document.querySelectorAll('[data-testid^="pkg-sort-"]').forEach(function(b){b.addEventListener('click',function(){var k=b.getAttribute('data-key');var dir=b.getAttribute('aria-sort')==='ascending'?-1:1;document.querySelectorAll('[data-testid^="pkg-sort-"]').forEach(function(x){x.removeAttribute('aria-sort');});b.setAttribute('aria-sort',dir===1?'ascending':'descending');var rows=Array.prototype.slice.call(t.rows);rows.sort(function(a,c){var x=a.getAttribute('data-'+k)||'',y=c.getAttribute('data-'+k)||'';var r=num[k]?(Number(x)-Number(y)):x.localeCompare(y,'da',{numeric:true});return r*dir;});rows.forEach(function(r){t.appendChild(r);});});});})();`;
  return `<!doctype html><html lang="da" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="${FAVICON}"><title>Packages — Discovery</title>
<style>${SITE_CSS}${PAGE_CSS}</style></head>
<body>${topBar({ active: "/packages" })}
<div class="wrap"><main data-testid="packages-root"><section class="hero"><h1><span class="at">Alle vores </span>pakker</h1><p>${rows.length} udgivne <code>@broberg</code>-pakker · ${tp} udgivet via Trusted Publisher · ${vulnerable} med sårbare afhængigheder · forbrugere scannet ${esc(scanned ?? "aldrig")}. Klik på en kolonne for at sortere. Som data: <code>/api/packages</code>.</p></section>
<div class="pk-wrap"><table class="pk-table" data-testid="pkg-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></main></div>
<script>(function(){${THEME_JS}})();${sortJs}</script></body></html>`;
}

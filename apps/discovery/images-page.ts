// F038.39 — «Images»: what every Fly app in the fleet actually runs on, from the
// image-hygiene engine's nightly report (via cardmem's GET /api/image-hygiene/latest),
// never from a Dockerfile on disk (measured stale: pitch, cronjobs).
import { SITE_CSS, topBar, THEME_JS, SEARCH_MODAL, SEARCH_JS } from "../../scripts/site-chrome.mjs";
import { FAVICON } from "../../scripts/favicon.mjs";
import { daTime } from "../../scripts/npm-meta.mjs";

/** One row of cardmem's /api/image-hygiene/latest. status null = never reported. */
export interface ImageRow {
  app: string;
  project: string | null;
  status: string | null;
  at: string | null;
  base_os: string | null;
  base_image: string | null;
  base_image_exception: string | null;
  node_version: string | null;
  critical_fixable: number | null;
  sha: string | null;
  run_id: string | number | null;
}

export type SlimVerdict = "follows" | "not" | "exception" | "unknown";

/** The owner's slim standard (23/10 2026): node:24-slim or oven/bun:1-slim, floating
 *  in the major, optionally pinned by digest. An unknown base is UNKNOWN, never «not». */
export function slimVerdict(r: Pick<ImageRow, "base_image" | "base_image_exception">): SlimVerdict {
  if (r.base_image_exception) return "exception";
  const b = r.base_image?.trim();
  if (!b || b.includes("$")) return "unknown";
  return /^(node:24-slim|oven\/bun:1-slim)(@sha256:[0-9a-f]{64})?$/.test(b) ? "follows" : "not";
}

export const VERDICT_LABEL: Record<SlimVerdict, string> = {
  follows: "følger",
  not: "følger ikke",
  exception: "undtagelse",
  unknown: "ukendt",
};

export type ImagesResult =
  | { ok: true; rows: ImageRow[]; fetchedAt: string }
  | { ok: false; reason: "not_configured" | "fetch_failed"; detail?: string };

/** Fetch the latest report per app. Never throws: a failure is a result, said out loud. */
export async function fetchImages(
  key: string | undefined,
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<ImagesResult> {
  if (!key) return { ok: false, reason: "not_configured" };
  try {
    const res = await fetchFn(url, { headers: { "x-hygiene-read-key": key }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, reason: "fetch_failed", detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { apps?: ImageRow[] };
    if (!Array.isArray(body.apps)) return { ok: false, reason: "fetch_failed", detail: "svaret havde ingen apps-liste" };
    return { ok: true, rows: body.apps, fetchedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", detail: e instanceof Error ? e.message : String(e) };
  }
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function statusCell(r: ImageRow): string {
  if (r.status == null) return `<span class="im-none">ingen kørsel endnu</span>`;
  const cls = r.status === "ok" ? "im-ok" : "im-bad";
  return `<span class="${cls}">${esc(r.status)}</span>`;
}

function runtime(r: ImageRow): string {
  if (r.node_version) return `node ${esc(r.node_version)}`;
  if (r.base_image?.startsWith("oven/bun")) return "bun";
  return r.status == null ? "—" : "ukendt";
}

const PAGE_CSS = `
  .im-wrap{overflow-x:auto;margin:22px 0 60px}
  .im-table{width:100%;border-collapse:collapse;font-size:13.5px}
  .im-table th{text-align:left;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding:10px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
  .im-table td{padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top}
  .im-table tr:hover td{background:var(--panel)}
  .im-table code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg)}
  .im-follows,.im-ok{color:var(--green)} .im-not,.im-bad{color:var(--amber);font-weight:700}
  .im-exception{color:var(--muted)} .im-unknown,.im-none{color:var(--faint)}
  .im-why{display:block;font-size:12px;color:var(--muted)}
  .im-sum{display:flex;gap:18px;flex-wrap:wrap;margin:16px 0 0;font-size:13.5px;color:var(--muted)}
  .im-sum b{color:var(--fg)}
  .im-note{margin:22px 0;padding:16px 18px;border:1px solid var(--border);border-radius:10px;background:var(--panel)}
`;

export function renderImagesPage(result: ImagesResult): string {
  let body: string;
  if (!result.ok) {
    const msg = result.reason === "not_configured"
      ? "Oversigten er ikke slået til endnu: Discovery mangler læsenøglen til cardmems image-rapporter (Fly-secret HYGIENE_READ_KEY)."
      : `Rapporterne kunne ikke hentes fra cardmem lige nu${result.detail ? ` (${esc(result.detail)})` : ""}. Prøv igen om lidt.`;
    body = `<div class="im-note" data-testid="images-unavailable" data-reason="${result.reason}">${msg}</div>`;
  } else {
    const rows = [...result.rows].sort((a, b) => a.app.localeCompare(b.app));
    const count = (v: SlimVerdict) => rows.filter((r) => r.status != null && slimVerdict(r) === v).length;
    const never = rows.filter((r) => r.status == null).length;
    body = `<div class="im-sum" data-testid="images-summary">
      <span><b>${rows.length}</b> apps</span>
      <span><b>${count("follows")}</b> følger slim-standarden</span>
      <span><b>${count("not")}</b> følger ikke</span>
      <span><b>${count("exception")}</b> undtagelser</span>
      <span><b>${never}</b> ingen kørsel endnu</span>
      <span>Hentet ${esc(daTime(result.fetchedAt) ?? "")}</span>
    </div>
    <div class="im-wrap"><table class="im-table" data-testid="images-table">
      <thead><tr><th>App</th><th>Projekt</th><th>Base-image</th><th>Distro</th><th>Runtime</th><th>Slim-standard</th><th>Sidst kørt</th><th>Status</th></tr></thead>
      <tbody>${rows.map((r) => {
        const v = r.status == null ? "unknown" : slimVerdict(r);
        return `<tr data-testid="images-row-${slug(r.app)}" data-verdict="${v}">
        <td><b>${esc(r.app)}</b></td>
        <td>${esc(r.project ?? "—")}</td>
        <td>${r.base_image ? `<code>${esc(r.base_image)}</code>` : "—"}</td>
        <td>${esc(r.base_os ?? "—")}</td>
        <td>${runtime(r)}</td>
        <td><span class="im-${v}">${r.status == null ? "—" : VERDICT_LABEL[v]}</span>${v === "exception" ? `<span class="im-why">${esc(r.base_image_exception)}</span>` : ""}</td>
        <td>${esc(r.at ? daTime(r.at) ?? r.at : "—")}</td>
        <td>${statusCell(r)}</td>
      </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  }
  return `<!doctype html><html lang="da" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="${FAVICON}"><title>Images — @broberg</title><style>${SITE_CSS}${PAGE_CSS}</style></head>
<body>${topBar({ active: "/images" })}
<div class="wrap" data-testid="images-root">
  <section class="hero"><h1>Hvad kører <span class="at">appsene</span> på</h1>
  <p>Base-image, distro og runtime for hver Fly-app i flåden — målt på det image der faktisk blev udrullet, af image-hygiejne-motoren hver nat. Slim-standarden: <code>node:24-slim</code> eller <code>oven/bun:1-slim</code>.</p></section>
  ${body}
</div>
${SEARCH_MODAL}
<script>(function(){${THEME_JS}})();</script>
<script>${SEARCH_JS}</script></body></html>`;
}

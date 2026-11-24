// F038.50 — Playbooks: step-by-step recipes written by the repo session that learned
// them (first one: sanneandersen's «Stripe Connect — direct charges», 24/11 2026),
// findable like everything else in Discovery. ONE source: the playbooks table in
// Discovery's own database. A session submits/updates ITS OWN playbook with
// POST /api/playbooks and the same key it enrolls with.
//
// A playbook body is UNTRUSTED markdown. renderMarkdown escapes everything first and
// only then recognises a small set of constructs — there is no path for raw HTML.
import { createClient, type Client, type Row } from "@libsql/client";
import { SITE_CSS, topBar } from "../../scripts/site-chrome.mjs";
import { FAVICON } from "../../scripts/favicon.mjs";
import { daTime } from "../../scripts/npm-meta.mjs";
import { REPO_SLUG } from "./enroll";

export const PLAYBOOK_SLUG = /^[a-z0-9][a-z0-9-]{2,79}$/;
export const PLAYBOOK_LIMITS = { title: 160, summary: 400, body: 200_000, kw: 30, kwLen: 60 } as const;

export interface Playbook {
  slug: string;
  title: string;
  summary: string;
  kw: string[];
  body: string;
  owner: string;
  repo: string | null;
  created_at: number;
  updated_at: number;
  revision: number;
}
export type PlaybookMeta = Omit<Playbook, "body">;

export interface PlaybookInput {
  slug: string;
  title: string;
  summary: string;
  kw: string[];
  body: string;
  repo: string | null;
}

/** Check a POST body. Returns the cleaned input, or the first thing wrong with it. */
export function validatePlaybook(b: unknown): { ok: true; value: PlaybookInput } | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "body must be a JSON object" };
  const o = b as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const slug = str("slug");
  if (!PLAYBOOK_SLUG.test(slug)) return { ok: false, error: "slug must match ^[a-z0-9][a-z0-9-]{2,79}$" };
  const title = str("title");
  if (!title || title.length > PLAYBOOK_LIMITS.title) return { ok: false, error: `title is required (max ${PLAYBOOK_LIMITS.title} chars)` };
  const summary = str("summary");
  if (!summary || summary.length > PLAYBOOK_LIMITS.summary) return { ok: false, error: `summary is required (max ${PLAYBOOK_LIMITS.summary} chars)` };
  const body = typeof o.body === "string" ? o.body : "";
  if (!body.trim()) return { ok: false, error: "body (markdown) is required" };
  if (new TextEncoder().encode(body).length > PLAYBOOK_LIMITS.body) return { ok: false, error: `body is larger than ${PLAYBOOK_LIMITS.body} bytes` };
  const kwRaw = o.kw ?? [];
  if (!Array.isArray(kwRaw) || kwRaw.length > PLAYBOOK_LIMITS.kw || kwRaw.some((k) => typeof k !== "string" || !k.trim() || k.length > PLAYBOOK_LIMITS.kwLen)) {
    return { ok: false, error: `kw must be an array of up to ${PLAYBOOK_LIMITS.kw} non-empty strings (max ${PLAYBOOK_LIMITS.kwLen} chars each)` };
  }
  const repo = o.repo == null || o.repo === "" ? null : typeof o.repo === "string" && REPO_SLUG.test(o.repo) ? o.repo : undefined;
  if (repo === undefined) return { ok: false, error: "repo must be owner/name, or omitted" };
  return { ok: true, value: { slug, title, summary, kw: (kwRaw as string[]).map((k) => k.trim()), body, repo } };
}

// ---- store ---------------------------------------------------------------

const CREATE = `CREATE TABLE IF NOT EXISTS playbooks (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  kw TEXT NOT NULL,
  body TEXT NOT NULL,
  owner_session TEXT NOT NULL,
  repo TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL
)`;

const toPlaybook = (r: Row): Playbook => ({
  slug: String(r.slug),
  title: String(r.title),
  summary: String(r.summary),
  kw: JSON.parse(String(r.kw)) as string[],
  body: String(r.body),
  owner: String(r.owner_session),
  repo: r.repo == null ? null : String(r.repo),
  created_at: Number(r.created_at),
  updated_at: Number(r.updated_at),
  revision: Number(r.revision),
});
export const metaOf = ({ body: _b, ...m }: Playbook): PlaybookMeta => m;

export type SaveResult = { ok: true; playbook: Playbook; created: boolean } | { ok: false; reason: "not_owner"; owner: string };

export interface PlaybookStore {
  /** Create, or update when `session` owns the slug. Another session's slug is refused. */
  save(session: string, input: PlaybookInput): Promise<SaveResult>;
  get(slug: string): Promise<Playbook | null>;
  list(): Promise<Playbook[]>;
}

export function makePlaybookStore(client: Client): PlaybookStore {
  return {
    async save(session, input) {
      const now = Date.now();
      const existing = await this.get(input.slug);
      if (existing && existing.owner !== session) return { ok: false, reason: "not_owner", owner: existing.owner };
      if (existing) {
        await client.execute({
          sql: "UPDATE playbooks SET title=?, summary=?, kw=?, body=?, repo=?, updated_at=?, revision=revision+1 WHERE slug=? AND owner_session=?",
          args: [input.title, input.summary, JSON.stringify(input.kw), input.body, input.repo, now, input.slug, session],
        });
      } else {
        await client.execute({
          sql: "INSERT INTO playbooks (slug, title, summary, kw, body, owner_session, repo, created_at, updated_at, revision) VALUES (?,?,?,?,?,?,?,?,?,1)",
          args: [input.slug, input.title, input.summary, JSON.stringify(input.kw), input.body, session, input.repo, now, now],
        });
      }
      return { ok: true, playbook: (await this.get(input.slug))!, created: !existing };
    },
    async get(slug) {
      const rs = await client.execute({ sql: "SELECT * FROM playbooks WHERE slug = ?", args: [slug] });
      return rs.rows.length ? toPlaybook(rs.rows[0]!) : null;
    },
    async list() {
      const rs = await client.execute("SELECT * FROM playbooks ORDER BY updated_at DESC");
      return rs.rows.map(toPlaybook);
    },
  };
}

// Same database as the enroll store (ENROLL_DB_URL in tests, TURSO_DATABASE_URL in prod).
let _init: Promise<PlaybookStore | null> | null = null;
export function getPlaybookStore(): Promise<PlaybookStore | null> {
  if (!_init) {
    _init = (async () => {
      const url = process.env.ENROLL_DB_URL || process.env.TURSO_DATABASE_URL;
      if (!url) return null;
      const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
      await client.execute(CREATE);
      return makePlaybookStore(client);
    })();
    _init.catch(() => { _init = null; });
  }
  return _init;
}

// ---- search + llms -------------------------------------------------------

/** Every query token must appear in title, summary, kw or body. */
export function matchPlaybook(p: Playbook, ql: string): boolean {
  const hay = `${p.title} ${p.summary} ${p.kw.join(" ")} ${p.body}`.toLowerCase();
  const tokens = ql.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => hay.includes(t));
}

export const playbookUrl = (slug: string) => `https://discovery.broberg.ai/playbooks/${slug}`;

/** The index for /llms.txt and /ai: one line per playbook. */
export function playbooksLlmsIndex(list: Playbook[]): string {
  if (!list.length) return "";
  return `\n\n## Playbooks — step-by-step recipes from the fleet\n\n${list.map((p) => `- [${p.title}](${playbookUrl(p.slug)}): ${p.summary} (by ${p.owner})`).join("\n")}\n`;
}

/** /llms-full.txt: the whole text of every playbook. */
export function playbooksLlmsFull(list: Playbook[]): string {
  if (!list.length) return "";
  return `\n\n# Playbooks\n${list.map((p) => `\n---\n\n## Playbook: ${p.title}\n\nURL: ${playbookUrl(p.slug)} · by ${p.owner}${p.repo ? ` (${p.repo})` : ""} · revision ${p.revision}\n\n${p.body.trim()}\n`).join("")}`;
}

// ---- safe markdown -------------------------------------------------------

export const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Inline: escape FIRST, then `code`, **bold**, *em*, [text](http(s) url). */
function inline(text: string): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_m, c: string) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  // The URL is already escaped; only http(s) becomes a link, anything else stays text.
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]!);
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (/^```/.test(l)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) buf.push(lines[i++]!);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { const n = Math.min(h[1]!.length + 1, 6); out.push(`<h${n}>${inline(h[2]!)}</h${n}>`); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
    if (isTableRow(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const head = cells(l);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!)) rows.push(cells(lines[i++]!));
      out.push(`<div class="pb-tw"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) buf.push(lines[i++]!.replace(/^>\s?/, ""));
      out.push(`<blockquote>${buf.map(inline).join("<br>")}</blockquote>`);
      continue;
    }
    const li = /^\s*([-*]|\d+\.)\s+/;
    if (li.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const buf: string[] = [];
      while (i < lines.length && li.test(lines[i]!)) buf.push(lines[i++]!.replace(li, ""));
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${buf.map((b) => `<li>${inline(b)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(```|#{1,6}\s|>|\s*([-*]|\d+\.)\s)/.test(lines[i]!) && !isTableRow(lines[i]!)) buf.push(lines[i++]!);
    out.push(`<p>${buf.map(inline).join(" ")}</p>`);
  }
  return out.join("\n");
}

// ---- pages ---------------------------------------------------------------

const PAGE_CSS = `
.pb-list{list-style:none;padding:0;margin:16px 0;display:grid;gap:12px}
.pb-item{border:1px solid var(--border);border-radius:var(--radius,8px);padding:14px 16px;background:var(--card)}
.pb-item a.pb-title{font-weight:600;font-size:1.05rem;color:var(--fg);text-decoration:none}
.pb-item a.pb-title:hover{text-decoration:underline}
.pb-meta{color:var(--muted);font-size:.85rem;margin-top:4px}
.pb-body{max-width:860px;line-height:1.6;overflow-wrap:anywhere}
.pb-body pre{overflow-x:auto;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:6px}
.pb-body code{font-size:.9em}
.pb-body blockquote{margin:12px 0;padding:8px 14px;border-left:3px solid var(--border);color:var(--muted)}
.pb-tw{overflow-x:auto;margin:12px 0}
.pb-body table{border-collapse:collapse;font-size:.9rem}
.pb-body th,.pb-body td{border:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}
.pb-how{margin-top:28px;color:var(--muted);font-size:.9rem}
.pb-body ul,.pb-body ol{padding-left:1.6em}
[data-testid="playbooks-root"] article a,.pb-body a{color:var(--green)}
`;

const page = (title: string, body: string) => `<!doctype html><html lang="da" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="${FAVICON}"><title>${esc(title)} — @broberg</title><style>${SITE_CSS}${PAGE_CSS}</style></head>
<body>${topBar({ active: "/playbooks" })}
<div class="wrap" data-testid="playbooks-root">${body}</div></body></html>`;

const metaLine = (p: PlaybookMeta) =>
  `Indmeldt af <b>${esc(p.owner)}</b>${p.repo ? ` (${esc(p.repo)})` : ""} · opdateret ${esc(daTime(new Date(p.updated_at).toISOString()) ?? "")} · version ${p.revision}`;

export function renderPlaybookList(list: PlaybookMeta[]): string {
  const items = list.length
    ? `<ul class="pb-list" data-testid="playbooks-list">${list.map((p) => `<li class="pb-item" data-testid="playbooks-item-${esc(p.slug)}">
  <a class="pb-title" href="/playbooks/${esc(p.slug)}" data-testid="playbooks-link-${esc(p.slug)}">${esc(p.title)}</a>
  <div>${esc(p.summary)}</div><div class="pb-meta">${metaLine(p)}</div></li>`).join("")}</ul>`
    : `<p data-testid="playbooks-empty">Ingen playbooks endnu.</p>`;
  return page("Playbooks", `<section class="hero"><h1>Playbooks</h1><p>Trin-for-trin-opskrifter skrevet af den session, der lærte dem. Indholdet er den indmeldende sessions; components ejer kun formen.</p></section>
${items}
<p class="pb-how" data-testid="playbooks-how">Indmeld eller opdater din egen: <code>POST /api/playbooks</code> med <code>x-discovery-session</code> + <code>x-enroll-key</code> og <code>{slug, title, summary, kw[], body, repo?}</code>.</p>`);
}

export function renderPlaybookPage(p: Playbook): string {
  return page(p.title, `<article data-testid="playbook-${esc(p.slug)}">
<p><a href="/playbooks" data-testid="playbook-back">← Alle playbooks</a></p>
<h1>${esc(p.title)}</h1><p class="pb-meta" data-testid="playbook-meta">${metaLine(p)}</p>
<div class="pb-body" data-testid="playbook-body">${renderMarkdown(p.body)}</div></article>`);
}

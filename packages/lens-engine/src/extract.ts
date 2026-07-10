// @broberg/lens-engine — extract() reader. Auto-detect REPEATING DOM structures
// (tables + explicit lists) → structured JSON, deterministically, with zero LLM.
//
// v1 fence (locked cc-to-cc, do NOT drift): <table> + role=table|grid, explicit
// lists (ul/ol/dl), and a repeated-sibling-grid gate (>= minRows siblings sharing a
// non-empty class-signature) surfaced as {text, href?}. NO decomposition into
// arbitrary sub-fields — that heuristic is the noise this fence deliberately omits.
//
// The heuristic is a PURE node function (extractRegions) over a jsdom document, so
// it is offline-testable; extract() just feeds it `page.content()`.

import type { Page } from 'playwright';
import { JSDOM } from 'jsdom';
import { withPageSession } from './page-session';

export interface ExtractHint {
  /** WHERE: only inside this container (CSS selector). Default: the whole document. */
  selector?: string;
  /** WHICH detector. Default 'auto' (both table + list). */
  kind?: 'auto' | 'table' | 'list';
  /** Keep a region only if its detected columns ⊇ these (disambiguate tables). */
  mustHaveColumns?: string[];
  /**
   * Positional rename + whitelist of output keys: the i-th detected column becomes
   * columns[i]; detected columns past this list are dropped. (Rename + "drop the rest".)
   */
  columns?: string[];
  /** A repeated-sibling-grid counts as 'list' only at >= this many siblings. Default 3. */
  minRows?: number;
  /** Cap rows per region (token-guard). Default: all. */
  limit?: number;
}

export interface ExtractRegion {
  kind: 'table' | 'list';
  /** Stable CSS path to the region (drill / verify anchor). */
  selector: string;
  columns: string[];
  rows: Record<string, string>[];
  /** Total rows detected BEFORE `limit`. */
  totalRows: number;
  truncated: boolean;
  /** 'high' = real <table>/<ul|ol|dl>; 'medium' = inferred repeated-sibling-grid. */
  confidence: 'high' | 'medium';
}

export interface ExtractResult {
  url: string;
  /** Detected structures in DOM order; [] = nothing qualified (caller falls back to read()). */
  regions: ExtractRegion[];
}

const DEFAULT_MIN_ROWS = 3;

interface Candidate {
  el: Element;
  kind: 'table' | 'list';
  confidence: 'high' | 'medium';
  columns: string[];
  rows: Record<string, string>[];
}

function collapse(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function classSignature(el: Element): string {
  const cls = Array.from(el.classList).sort().join('.');
  return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
}

function cssIdent(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

/** A short, reasonably-stable CSS path from the nearest id-bearing ancestor. */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
    if (cur.id) {
      parts.unshift(`#${cssIdent(cur.id)}`);
      break;
    }
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
    parts.unshift(sameTag.length === 1 ? tag : `${tag}:nth-of-type(${sameTag.indexOf(cur) + 1})`);
    cur = parent;
  }
  return parts.join(' > ');
}

/** DOM-order comparator (2 = PRECEDING, 4 = FOLLOWING; numeric literals — no `Node` global in node). */
function domOrder(a: Candidate, b: Candidate): number {
  if (a.el === b.el) return 0;
  const pos = a.el.compareDocumentPosition(b.el);
  if (pos & 4) return -1;
  if (pos & 2) return 1;
  return 0;
}

function detectTable(table: Element): { columns: string[]; rows: Record<string, string>[] } {
  const thead = table.querySelector('thead');
  const firstRow = table.querySelector('tr');
  const firstRowIsHeader =
    !thead && !!firstRow && firstRow.querySelectorAll('th').length > 0 && firstRow.querySelectorAll('td').length === 0;

  const headerCells = thead
    ? Array.from(thead.querySelectorAll('th, td'))
    : firstRowIsHeader
      ? Array.from(firstRow!.querySelectorAll('th, td'))
      : [];
  const columns = headerCells.map((c, i) => collapse(c.textContent) || `col${i + 1}`);

  const tbody = table.querySelector('tbody');
  const dataRows = tbody
    ? Array.from(tbody.querySelectorAll('tr'))
    : Array.from(table.querySelectorAll('tr')).filter(
        (tr) => !(firstRowIsHeader && tr === firstRow) && !(thead && thead.contains(tr)),
      );

  const rows = dataRows
    .map((tr) => {
      const cells = Array.from(tr.querySelectorAll('th, td'));
      const rec: Record<string, string> = {};
      cells.forEach((cell, i) => {
        rec[columns[i] ?? `col${i + 1}`] = collapse(cell.textContent);
      });
      return rec;
    })
    .filter((r) => Object.keys(r).length > 0);

  const cols = columns.length ? columns : rows[0] ? Object.keys(rows[0]) : [];
  return { columns: cols, rows };
}

function detectList(list: Element): { columns: string[]; rows: Record<string, string>[] } {
  const items = Array.from(list.children).filter((c) => c.tagName.toLowerCase() === 'li');
  let hasHref = false;
  const rows = items.map((li) => {
    const rec: Record<string, string> = { text: collapse(li.textContent) };
    const href = (li.querySelector('a[href]') as HTMLAnchorElement | null)?.getAttribute('href');
    if (href) {
      rec.href = href;
      hasHref = true;
    }
    return rec;
  });
  return { columns: hasHref ? ['text', 'href'] : ['text'], rows };
}

function detectDl(dl: Element): { columns: string[]; rows: Record<string, string>[] } {
  const rows: Record<string, string>[] = [];
  let term = '';
  for (const el of Array.from(dl.children)) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'dt') term = collapse(el.textContent);
    else if (tag === 'dd') rows.push({ term, definition: collapse(el.textContent) });
  }
  return { columns: ['term', 'definition'], rows };
}

/** A repeated-sibling-grid: >= minRows children sharing a non-empty class-signature. */
function detectGrid(container: Element, minRows: number): { columns: string[]; rows: Record<string, string>[] } | null {
  const children = Array.from(container.children);
  if (children.length < minRows) return null;

  const bySig = new Map<string, Element[]>();
  for (const c of children) {
    if (!c.classList.length) continue; // bare tags = too weak a signal
    const sig = classSignature(c);
    const arr = bySig.get(sig);
    if (arr) arr.push(c);
    else bySig.set(sig, [c]);
  }

  let best: Element[] | null = null;
  for (const group of bySig.values()) {
    if (group.length >= minRows && (!best || group.length > best.length)) best = group;
  }
  if (!best) return null;

  let hasHref = false;
  const rows = best.map((card) => {
    const rec: Record<string, string> = { text: collapse(card.textContent) };
    const anchor = card.matches('a[href]') ? card : card.querySelector('a[href]');
    const href = (anchor as HTMLAnchorElement | null)?.getAttribute('href');
    if (href) {
      rec.href = href;
      hasHref = true;
    }
    return rec;
  });
  return { columns: hasHref ? ['text', 'href'] : ['text'], rows };
}

const SKIP_GRID_TAGS = new Set(['ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tr']);

/** querySelectorAll that also yields `root` itself when it matches (so a hint.selector
 *  pointing straight AT a table/list is detected, not just its descendants). */
function matchAll(root: Element, sel: string): Element[] {
  const found = Array.from(root.querySelectorAll(sel));
  return root.matches(sel) ? [root, ...found] : found;
}

/**
 * Pure: HTML → detected regions (tables + lists), deterministically. Offline-testable
 * (jsdom, no browser, no LLM). See ExtractHint for the knobs.
 */
export function extractRegions(html: string, hint: ExtractHint = {}): { regions: ExtractRegion[] } {
  const doc = new JSDOM(html).window.document;
  const root: Element | null = hint.selector
    ? doc.querySelector(hint.selector)
    : (doc.body ?? doc.documentElement);
  if (!root) return { regions: [] };

  const kind = hint.kind ?? 'auto';
  const minRows = hint.minRows ?? DEFAULT_MIN_ROWS;
  const candidates: Candidate[] = [];

  if (kind === 'table' || kind === 'auto') {
    for (const table of matchAll(root, 'table, [role="table"], [role="grid"]')) {
      const { columns, rows } = detectTable(table);
      if (rows.length) candidates.push({ el: table, kind: 'table', confidence: 'high', columns, rows });
    }
  }

  if (kind === 'list' || kind === 'auto') {
    for (const list of matchAll(root, 'ul, ol')) {
      const { columns, rows } = detectList(list);
      if (rows.length) candidates.push({ el: list, kind: 'list', confidence: 'high', columns, rows });
    }
    for (const dl of matchAll(root, 'dl')) {
      const { columns, rows } = detectDl(dl);
      if (rows.length) candidates.push({ el: dl, kind: 'list', confidence: 'high', columns, rows });
    }
    // repeated-sibling-grids — scan root itself + every descendant container
    for (const container of [root, ...Array.from(root.querySelectorAll('*'))]) {
      if (SKIP_GRID_TAGS.has(container.tagName.toLowerCase())) continue;
      const grid = detectGrid(container, minRows);
      if (grid && grid.rows.length)
        candidates.push({ el: container, kind: 'list', confidence: 'medium', columns: grid.columns, rows: grid.rows });
    }
  }

  // Resolve overlaps: high-confidence structures (tables/lists) win over coarse
  // grids; drop any candidate nested inside a kept one.
  const kept: Candidate[] = [];
  for (const c of candidates.filter((c) => c.confidence === 'high').sort(domOrder)) {
    if (kept.some((k) => k.el.contains(c.el))) continue;
    kept.push(c);
  }
  for (const g of candidates.filter((c) => c.confidence === 'medium').sort((a, b) => b.rows.length - a.rows.length)) {
    if (kept.some((k) => k.el === g.el || k.el.contains(g.el) || g.el.contains(k.el))) continue;
    kept.push(g);
  }
  kept.sort(domOrder);

  const regions: ExtractRegion[] = [];
  for (const c of kept) {
    if (hint.mustHaveColumns?.length) {
      const have = new Set(c.columns);
      if (!hint.mustHaveColumns.every((col) => have.has(col))) continue;
    }

    let columns = c.columns;
    let rows = c.rows;
    if (hint.columns?.length) {
      const map = hint.columns
        .map((to, i) => ({ from: c.columns[i], to }))
        .filter((m): m is { from: string; to: string } => m.from !== undefined);
      columns = map.map((m) => m.to);
      rows = rows.map((r) => {
        const nr: Record<string, string> = {};
        for (const m of map) nr[m.to] = r[m.from] ?? '';
        return nr;
      });
    }

    const totalRows = rows.length;
    const truncated = typeof hint.limit === 'number' && totalRows > hint.limit;
    if (truncated) rows = rows.slice(0, hint.limit);

    regions.push({ kind: c.kind, selector: cssPath(c.el), columns, rows, totalRows, truncated, confidence: c.confidence });
  }

  return { regions };
}

/**
 * Extract structured tables/lists from a live page. A string target opens an
 * anonymous context; pass a live (possibly authed) Page to extract behind a login.
 */
export async function extract(target: string | Page, hint: ExtractHint = {}): Promise<ExtractResult> {
  return withPageSession(target, {}, undefined, async (page) => {
    const html = await page.content();
    return { url: page.url(), ...extractRegions(html, hint) };
  });
}

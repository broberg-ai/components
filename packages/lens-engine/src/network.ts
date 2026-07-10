// @broberg/lens-engine — network() reader. Capture the page's own XHR/fetch API
// responses so that when the data comes from an API, an agent can read the JSON
// directly and skip the HTML entirely (the biggest token win of the three readers).
//
// Only `fetch`/`xhr` resource-types are captured (documents, images, css, fonts are
// ignored). JSON bodies are parsed; other bodies are surfaced as raw text.
// Deterministic + fail-soft: zero LLM tokens; `responses: []` when nothing matches.

import type { Page, Response } from 'playwright';
import { withPageSession, type PageSessionOptions } from './page-session';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface NetworkResponse {
  url: string;
  status: number;
  method: string;
  contentType: string;
  /** Present when the content-type is JSON and the body parsed. */
  json?: unknown;
  /** Present for non-JSON bodies (or JSON that failed to parse). */
  text?: string;
}

export interface NetworkOptions extends PageSessionOptions {
  /** Keep only responses whose URL matches (substring or RegExp). Default: all. */
  urlPattern?: string | RegExp;
  /** Cap the number of responses returned. Default: all. */
  limit?: number;
}

export interface NetworkResult {
  url: string;
  responses: NetworkResponse[];
}

/** Pure: does `url` match the (optional) pattern? No pattern = match all. */
export function matchesUrlPattern(url: string, pattern?: string | RegExp): boolean {
  if (pattern == null) return true;
  return pattern instanceof RegExp ? pattern.test(url) : url.includes(pattern);
}

/**
 * Pure: shape captured response parts into a NetworkResponse — JSON content-types
 * are parsed into `json`, everything else (and JSON that fails to parse) is `text`.
 * Offline-testable — no Playwright needed.
 */
export function shapeResponseParts(parts: {
  url: string;
  status: number;
  method: string;
  contentType: string;
  body: string;
}): NetworkResponse {
  const base = { url: parts.url, status: parts.status, method: parts.method, contentType: parts.contentType };
  if (/\bjson\b/i.test(parts.contentType)) {
    try {
      return { ...base, json: JSON.parse(parts.body) };
    } catch {
      return { ...base, text: parts.body };
    }
  }
  return { ...base, text: parts.body };
}

async function shapeResponse(resp: Response): Promise<NetworkResponse> {
  const headers = await resp.allHeaders().catch(() => ({}) as Record<string, string>);
  const body = await resp.text().catch(() => '');
  return shapeResponseParts({
    url: resp.url(),
    status: resp.status(),
    method: resp.request().method(),
    contentType: headers['content-type'] ?? '',
    body,
  });
}

/**
 * Capture the XHR/fetch API responses a page makes. A string target opens an
 * anonymous context and navigates; pass a live Page to capture whatever fires
 * during the settle window on a page you already drive.
 */
export async function network(target: string | Page, opts: NetworkOptions = {}): Promise<NetworkResult> {
  const pending: Promise<NetworkResponse | null>[] = [];
  const attach = (page: Page) => {
    page.on('response', (resp) => {
      const rt = resp.request().resourceType();
      if (rt !== 'fetch' && rt !== 'xhr') return;
      if (!matchesUrlPattern(resp.url(), opts.urlPattern)) return;
      // Start reading the body now; we await all of them inside `work` (before the
      // context closes). A body that can't be read resolves to null and is dropped.
      pending.push(shapeResponse(resp).catch(() => null));
    });
  };
  return withPageSession(target, opts, attach, async (page) => {
    // Give in-flight API calls a chance to finish, guarded so a page that never
    // idles can't hang the read.
    await page.waitForLoadState('networkidle', { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS }).catch(() => {});
    const all = (await Promise.all(pending)).filter((r): r is NetworkResponse => r !== null);
    const responses = typeof opts.limit === 'number' ? all.slice(0, opts.limit) : all;
    return { url: page.url(), responses };
  });
}

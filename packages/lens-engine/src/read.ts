// @broberg/lens-engine — read() reader. Clean markdown of a page's MAIN content
// only (nav / header / footer / chrome stripped), so an agent reads ~a few hundred
// tokens instead of 15-30k of raw HTML.
//
// The heavy lifting is a PURE node function (htmlToMarkdown): @mozilla/readability
// over a jsdom document picks the main article, then turndown renders markdown;
// fail-soft to a boilerplate-stripped body when Readability finds nothing. That
// purity is what makes it offline-testable (no browser, no LLM) — the live read()
// wrapper just feeds it `page.content()`.

import type { Page } from 'playwright';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { withPageSession, type PageSessionOptions } from './page-session';

export interface ReadOptions extends PageSessionOptions {
  /** Scope extraction to this container (CSS selector) instead of the whole document. */
  selector?: string;
}

export interface ReadResult {
  url: string;
  title: string;
  markdown: string;
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });

/** Never main content — stripped before the fail-soft fallback. */
const BOILERPLATE = 'script,style,noscript,template,svg,iframe,nav,header,footer,aside,form';

function strippedMainHtml(doc: Document): string {
  const body = doc.body?.cloneNode(true) as HTMLElement | null;
  if (!body) return '';
  body.querySelectorAll(BOILERPLATE).forEach((n) => n.remove());
  const main = body.querySelector('main, article, [role="main"]') as HTMLElement | null;
  return (main ?? body).innerHTML;
}

/**
 * Pure: HTML → clean markdown of the main content. Offline-testable (jsdom, no
 * browser, no LLM). `selector` scopes extraction to one container.
 */
export function htmlToMarkdown(html: string, opts: { url?: string; selector?: string } = {}): ReadResult {
  const url = opts.url ?? 'https://example.invalid/';
  const doc = new JSDOM(html, { url }).window.document;
  const pageTitle = doc.title || '';

  let sourceDoc: Document = doc;
  if (opts.selector) {
    const el = doc.querySelector(opts.selector);
    if (el) {
      sourceDoc = new JSDOM(`<!doctype html><html><body>${el.innerHTML}</body></html>`, { url }).window.document;
    }
  }

  let articleHtml = '';
  let title = pageTitle;
  try {
    // Readability mutates its input document → hand it a clone.
    const article = new Readability(sourceDoc.cloneNode(true) as Document).parse();
    if (article?.content) {
      articleHtml = article.content;
      if (article.title) title = article.title;
    }
  } catch {
    /* fall through to the fail-soft path */
  }
  if (!articleHtml) articleHtml = strippedMainHtml(sourceDoc);

  const markdown = turndown
    .turndown(articleHtml)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { url, title, markdown };
}

/**
 * Read a live page as compact markdown of its main content. A string target opens
 * an anonymous context; pass a live (possibly authed) Page to read behind a login.
 */
export async function read(target: string | Page, opts: ReadOptions = {}): Promise<ReadResult> {
  return withPageSession(target, opts, undefined, async (page) => {
    const html = await page.content();
    return htmlToMarkdown(html, { url: page.url(), selector: opts.selector });
  });
}

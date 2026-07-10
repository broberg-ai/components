// @broberg/lens-engine — offline unit suite for the v0.2.0 READ primitives
// (read / extract / network). Same strategy as lens-engine.test.ts: no real
// Chromium — the pure cores (htmlToMarkdown, extractRegions, matchesUrlPattern,
// shapeResponseParts) are exercised directly; the live page-driving wrappers are
// proven by the consumer (cardmem F125) + a local run.

import { describe, test, expect } from 'vitest';
import { htmlToMarkdown } from '../src/read';
import { extractRegions } from '../src/extract';
import { matchesUrlPattern, shapeResponseParts } from '../src/network';

describe('network — matchesUrlPattern', () => {
  test('no pattern matches everything', () => {
    expect(matchesUrlPattern('https://a.dev/api/x')).toBe(true);
  });
  test('substring pattern', () => {
    expect(matchesUrlPattern('https://a.dev/api/users', '/api/')).toBe(true);
    expect(matchesUrlPattern('https://a.dev/static/app.js', '/api/')).toBe(false);
  });
  test('regexp pattern', () => {
    expect(matchesUrlPattern('https://a.dev/api/v2/users', /\/api\/v\d+\//)).toBe(true);
    expect(matchesUrlPattern('https://a.dev/api/users', /\/api\/v\d+\//)).toBe(false);
  });
});

describe('network — shapeResponseParts', () => {
  const base = { url: 'https://a.dev/api/x', status: 200, method: 'GET' };

  test('JSON content-type is parsed into json', () => {
    const r = shapeResponseParts({ ...base, contentType: 'application/json; charset=utf-8', body: '{"a":1,"b":[2]}' });
    expect(r.json).toEqual({ a: 1, b: [2] });
    expect(r.text).toBeUndefined();
  });
  test('invalid JSON falls back to text', () => {
    const r = shapeResponseParts({ ...base, contentType: 'application/json', body: '{not json' });
    expect(r.json).toBeUndefined();
    expect(r.text).toBe('{not json');
  });
  test('non-JSON body is text', () => {
    const r = shapeResponseParts({ ...base, contentType: 'text/html', body: '<p>hi</p>' });
    expect(r.text).toBe('<p>hi</p>');
    expect(r.json).toBeUndefined();
  });
  test('carries url/status/method/contentType through', () => {
    const r = shapeResponseParts({ ...base, contentType: 'text/plain', body: 'ok' });
    expect(r).toMatchObject({ url: base.url, status: 200, method: 'GET', contentType: 'text/plain' });
  });
});

// Markers are alphanumeric on purpose — turndown (correctly) escapes markdown
// metachars like `_`, so raw-underscore substrings wouldn't survive round-trip.
const ARTICLE_HTML = `<!doctype html><html><head><title>Test Article</title></head><body>
  <nav><a href="/">Home</a> <a href="/about">About</a> NAVLINKMARKER</nav>
  <header>SITEHEADERMARKER</header>
  <main>
    <article>
      <h1>The Main Headline</h1>
      <p>First paragraph with meaningful content about the subject at hand, long enough that
         Readability treats it as the primary article body and not boilerplate. ARTICLEMARKERONE.</p>
      <p>Second paragraph continues the discussion with additional sentences so the density
         heuristic clearly favours this block over the surrounding chrome. ARTICLEMARKERTWO.</p>
      <p>Third paragraph adds even more text to comfortably exceed the minimum content threshold
         Readability applies before it will return an article at all. ARTICLEMARKERTHREE.</p>
    </article>
  </main>
  <footer>FOOTERMARKER</footer>
</body></html>`;

describe('read — htmlToMarkdown', () => {
  test('keeps the main article, drops nav/header/footer', () => {
    const { markdown } = htmlToMarkdown(ARTICLE_HTML, { url: 'https://x.dev/post' });
    expect(markdown).toContain('The Main Headline');
    expect(markdown).toContain('ARTICLEMARKERONE');
    expect(markdown).toContain('ARTICLEMARKERTHREE');
    expect(markdown).not.toContain('NAVLINKMARKER');
    expect(markdown).not.toContain('SITEHEADERMARKER');
    expect(markdown).not.toContain('FOOTERMARKER');
  });

  test('markdown is an order of magnitude smaller than the input HTML', () => {
    const { markdown } = htmlToMarkdown(ARTICLE_HTML, { url: 'https://x.dev/post' });
    expect(markdown.length).toBeLessThan(ARTICLE_HTML.length * 0.7);
    expect(markdown.length).toBeGreaterThan(0);
  });

  test('selector scopes extraction to a container', () => {
    const { markdown } = htmlToMarkdown(ARTICLE_HTML, { selector: 'article' });
    expect(markdown).toContain('ARTICLEMARKERTWO');
    expect(markdown).not.toContain('FOOTERMARKER');
  });

  test('fail-soft: a page Readability cannot parse never throws', () => {
    const { markdown } = htmlToMarkdown('<html><body><p>tiny fallback body</p></body></html>');
    expect(markdown).toContain('tiny fallback body');
  });
});

const TABLE_HTML = `<table>
  <thead><tr><th>Name</th><th>Role</th></tr></thead>
  <tbody>
    <tr><td>Ada</td><td>Engineer</td></tr>
    <tr><td>Linus</td><td>Kernel</td></tr>
    <tr><td>Grace</td><td>Compiler</td></tr>
  </tbody>
</table>`;

const RICH_HTML = `<main>
  ${TABLE_HTML}
  <ul>
    <li><a href="/a">Alpha</a></li>
    <li><a href="/b">Beta</a></li>
  </ul>
  <dl>
    <dt>HTTP</dt><dd>HyperText Transfer Protocol</dd>
    <dt>URL</dt><dd>Uniform Resource Locator</dd>
  </dl>
  <div class="cards">
    <article class="card"><a href="/1">One</a> body one</article>
    <article class="card"><a href="/2">Two</a> body two</article>
    <article class="card"><a href="/3">Three</a> body three</article>
  </div>
  <div class="pair">
    <span class="c2">x</span>
    <span class="c2">y</span>
  </div>
</main>`;

describe('extract — extractRegions', () => {
  test('detects a table with header columns + rows (high confidence)', () => {
    const { regions } = extractRegions(TABLE_HTML);
    expect(regions).toHaveLength(1);
    const t = regions[0]!;
    expect(t.kind).toBe('table');
    expect(t.confidence).toBe('high');
    expect(t.columns).toEqual(['Name', 'Role']);
    expect(t.rows).toEqual([
      { Name: 'Ada', Role: 'Engineer' },
      { Name: 'Linus', Role: 'Kernel' },
      { Name: 'Grace', Role: 'Compiler' },
    ]);
    expect(t.totalRows).toBe(3);
    expect(t.truncated).toBe(false);
  });

  test('detects ul (text+href), dl (term/definition), and a repeated-sibling-grid (medium)', () => {
    const { regions } = extractRegions(RICH_HTML);
    // table, ul, dl, .cards grid — in DOM order. The 2-item .pair grid is below minRows → dropped.
    expect(regions.map((r) => `${r.kind}:${r.confidence}`)).toEqual([
      'table:high',
      'list:high',
      'list:high',
      'list:medium',
    ]);

    const ul = regions[1]!;
    expect(ul.columns).toEqual(['text', 'href']);
    expect(ul.rows).toEqual([
      { text: 'Alpha', href: '/a' },
      { text: 'Beta', href: '/b' },
    ]);

    const dl = regions[2]!;
    expect(dl.columns).toEqual(['term', 'definition']);
    expect(dl.rows[0]).toEqual({ term: 'HTTP', definition: 'HyperText Transfer Protocol' });

    const grid = regions[3]!;
    expect(grid.confidence).toBe('medium');
    expect(grid.columns).toEqual(['text', 'href']);
    expect(grid.rows).toHaveLength(3);
    expect(grid.rows[0]).toEqual({ text: 'One body one', href: '/1' });
  });

  test('a repeated grid below minRows is not emitted; raising minRows drops the 3-card grid too', () => {
    const only3 = extractRegions('<div class="g"><b class="i">1</b><b class="i">2</b><b class="i">3</b></div>');
    expect(only3.regions).toHaveLength(1);
    expect(only3.regions[0]!.confidence).toBe('medium');
    const raised = extractRegions('<div class="g"><b class="i">1</b><b class="i">2</b><b class="i">3</b></div>', {
      minRows: 4,
    });
    expect(raised.regions).toHaveLength(0);
  });

  test('kind:"table" returns only tables', () => {
    const { regions } = extractRegions(RICH_HTML, { kind: 'table' });
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('table');
  });

  test('mustHaveColumns filters to matching regions', () => {
    const { regions } = extractRegions(RICH_HTML, { mustHaveColumns: ['Name', 'Role'] });
    expect(regions).toHaveLength(1);
    expect(regions[0]!.columns).toEqual(['Name', 'Role']);
  });

  test('columns positionally rename + drop the rest', () => {
    const { regions } = extractRegions(TABLE_HTML, { columns: ['navn'] });
    expect(regions[0]!.columns).toEqual(['navn']);
    expect(regions[0]!.rows[0]).toEqual({ navn: 'Ada' });
  });

  test('limit truncates rows and reports totalRows + truncated', () => {
    const { regions } = extractRegions(TABLE_HTML, { limit: 2 });
    const t = regions[0]!;
    expect(t.rows).toHaveLength(2);
    expect(t.totalRows).toBe(3);
    expect(t.truncated).toBe(true);
  });

  test('selector scopes detection to a container', () => {
    const { regions } = extractRegions(RICH_HTML, { selector: 'ul' });
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('list');
    expect(regions[0]!.rows[0]).toEqual({ text: 'Alpha', href: '/a' });
  });

  test('nothing qualifies → empty regions (caller falls back to read())', () => {
    expect(extractRegions('<main><p>just prose, no structures</p></main>').regions).toEqual([]);
  });

  test('a table region exposes a stable selector anchor', () => {
    const { regions } = extractRegions('<div id="board">' + TABLE_HTML + '</div>');
    expect(regions[0]!.selector).toContain('#board');
  });
});

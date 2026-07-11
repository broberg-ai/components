import { describe, it, expect } from 'vitest';
import { computeCoverage, type CoverageSchema } from '../src/coverage';

const schema: CoverageSchema = {
  page: { fields: ['title', 'body', 'hero'] },
  post: { fields: ['heading', 'content'] },
};

describe('computeCoverage', () => {
  it('reports 100% when every expected field is tagged', () => {
    const html = `
      <div data-cms-collection="page" data-cms-slug="home" data-cms-field="title">T</div>
      <div data-cms-collection="page" data-cms-slug="home" data-cms-field="body">B</div>
      <div data-cms-collection="page" data-cms-slug="home" data-cms-field="hero">H</div>`;
    const { pages } = computeCoverage(html, schema);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      collection: 'page',
      slug: 'home',
      present: ['body', 'hero', 'title'],
      expected: ['body', 'hero', 'title'],
      missing: [],
      orphans: [],
      coveragePct: 100,
    });
  });

  it('lists MISSING fields (the actionable gap)', () => {
    const html = `<div data-cms-collection="page" data-cms-slug="home" data-cms-field="title">T</div>`;
    const { pages } = computeCoverage(html, schema);
    expect(pages[0].missing).toEqual(['body', 'hero']);
    expect(pages[0].coveragePct).toBe(33); // 1/3
  });

  it('flags orphans — a tagged field not in the schema', () => {
    const html = `
      <div data-cms-collection="page" data-cms-slug="home" data-cms-field="title">T</div>
      <div data-cms-collection="page" data-cms-slug="home" data-cms-field="subtitle">S</div>`;
    const { pages } = computeCoverage(html, schema);
    expect(pages[0].orphans).toEqual(['subtitle']);
    expect(pages[0].missing).toEqual(['body', 'hero']);
  });

  it('an element without collection/slug becomes an orphan and never throws', () => {
    const html = `<div data-cms-field="stray">x</div>`;
    const { pages } = computeCoverage(html, schema);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ collection: '', slug: '', expected: [], orphans: ['stray'], coveragePct: 100 });
  });

  it('a (collection,slug) whose collection is not in the schema → all present are orphans', () => {
    const html = `<div data-cms-collection="gallery" data-cms-slug="g1" data-cms-field="caption">c</div>`;
    const { pages } = computeCoverage(html, schema);
    expect(pages[0]).toMatchObject({ collection: 'gallery', expected: [], orphans: ['caption'], missing: [] });
  });

  it('ignoreFields removes a field from BOTH present and expected before the diff', () => {
    const html = `
      <div data-cms-collection="page" data-cms-slug="home" data-cms-field="title">T</div>
      <div data-cms-collection="page" data-cms-slug="home" data-cms-field="body">B</div>`;
    // Without ignore: hero is missing. Ignoring hero removes it from expected → 100%.
    const { pages } = computeCoverage(html, schema, { ignoreFields: ['hero'] });
    expect(pages[0].expected).toEqual(['body', 'title']);
    expect(pages[0].missing).toEqual([]);
    expect(pages[0].coveragePct).toBe(100);
  });

  it('groups multiple (collection,slug) pairs on one page into separate entries', () => {
    const html = `
      <div data-cms-collection="page" data-cms-slug="home" data-cms-field="title">T</div>
      <div data-cms-collection="post" data-cms-slug="hello" data-cms-field="heading">H</div>
      <div data-cms-collection="post" data-cms-slug="hello" data-cms-field="content">C</div>`;
    const { pages } = computeCoverage(html, schema);
    expect(pages.map((p) => `${p.collection}/${p.slug}`)).toEqual(['page/home', 'post/hello']);
    expect(pages[1]).toMatchObject({ missing: [], coveragePct: 100 });
    expect(pages[0].missing).toEqual(['body', 'hero']);
  });

  it('richtext/html attributes on the same field count as one field-name', () => {
    const html = `<div data-cms-collection="post" data-cms-slug="p" data-cms-field="content" data-cms-richtext="true">c</div>
      <div data-cms-collection="post" data-cms-slug="p" data-cms-field="heading">h</div>`;
    const { pages } = computeCoverage(html, schema);
    expect(pages[0].present).toEqual(['content', 'heading']);
    expect(pages[0].coveragePct).toBe(100);
  });
});

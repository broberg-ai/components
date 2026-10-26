// F005.27 — the BIMI logo check: one fixture per rule, plus two real logos.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { validateBimiSvg, BIMI_SVG_MAX_BYTES } from '../src/verify';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100"><title>Brand</title><rect width="100" height="100" fill="#123456"/></svg>';
const rules = (svg: string) => validateBimiSvg(svg).map((p) => p.rule);

describe('F005.27 — validateBimiSvg', () => {
  it('a correct Tiny PS logo passes with an empty list', () => {
    expect(validateBimiSvg(GOOD)).toEqual([]);
  });

  it('REAL LOGOS: the owner-approved broberg.ai B mark and the live Jam logo both pass', () => {
    expect(validateBimiSvg(fixture('broberg-mark-bimi.svg'))).toEqual([]);
    expect(validateBimiSvg(fixture('bimi-jam.svg'))).toEqual([]);
  });

  it('missing baseProfile="tiny-ps" is named', () => {
    expect(rules(GOOD.replace(' baseProfile="tiny-ps"', ''))).toEqual(['base-profile']);
    expect(rules(GOOD.replace('tiny-ps', 'tiny'))).toEqual(['base-profile']);
  });

  it('missing or wrong version is named', () => {
    expect(rules(GOOD.replace(' version="1.2"', ''))).toEqual(['version']);
    expect(rules(GOOD.replace('version="1.2"', 'version="1.1"'))).toEqual(['version']);
  });

  it('a non-square viewBox is named; a missing one is named differently', () => {
    expect(rules(GOOD.replace('0 0 100 100', '0 0 200 100'))).toEqual(['square']);
    expect(rules(GOOD.replace(' viewBox="0 0 100 100"', ''))).toEqual(['view-box']);
  });

  it('x= or y= on the root is named — but x= on a child is fine', () => {
    expect(rules(GOOD.replace('<svg ', '<svg x="0" '))).toEqual(['root-position']);
    expect(validateBimiSvg(GOOD.replace('<rect ', '<rect x="5" '))).toEqual([]);
  });

  it('a missing or empty <title> is named', () => {
    expect(rules(GOOD.replace('<title>Brand</title>', ''))).toEqual(['title']);
    expect(rules(GOOD.replace('<title>Brand</title>', '<title> </title>'))).toEqual(['title']);
  });

  it('<script> and event handlers are named', () => {
    expect(rules(GOOD.replace('</svg>', '<script>alert(1)</script></svg>'))).toEqual(['script']);
    expect(rules(GOOD.replace('<rect ', '<rect onclick="x()" '))).toEqual(['event-handler']);
  });

  it('an external href is named; a same-file #id is fine', () => {
    expect(rules(GOOD.replace('</svg>', '<use href="https://evil.example/x.svg#a"/></svg>'))).toEqual(['external-reference']);
    expect(rules(GOOD.replace('</svg>', '<use xlink:href="//cdn.example/a.svg"/></svg>'))).toEqual(['external-reference']);
    expect(validateBimiSvg(GOOD.replace('</svg>', '<defs><rect id="a"/></defs><use href="#a"/></svg>'))).toEqual([]);
  });

  it('<image> and <foreignObject> are named', () => {
    expect(rules(GOOD.replace('</svg>', '<image href="#a"/></svg>'))).toEqual(['image']);
    expect(rules(GOOD.replace('</svg>', '<foreignObject/></svg>'))).toEqual(['foreign-object']);
  });

  it('a file over 32 KB is named', () => {
    const big = GOOD.replace('</svg>', `<desc>${'x'.repeat(BIMI_SVG_MAX_BYTES)}</desc></svg>`);
    expect(rules(big)).toEqual(['size']);
  });

  it('no <svg> at all is named and nothing else is guessed', () => {
    expect(rules('<html></html>')).toEqual(['root']);
  });
});

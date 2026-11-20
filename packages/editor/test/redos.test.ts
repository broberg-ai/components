// F115.2 — CodeQL js/polynomial-redos on pasted HTML and markdown tail trimming.
import { describe, it, expect } from 'vitest';
import { sanitizePastedHTML, normalizeMarkdown } from '../src/index';

describe('F115.2 — editor sanitisers on hostile input', () => {
  it('100k unclosed "<!--" is linear and keeps the text', () => {
    const t = Date.now();
    const out = sanitizePastedHTML('<!--'.repeat(100_000));
    expect(Date.now() - t).toBeLessThan(500);
    expect(out.length).toBe(400_000);
  });
  it('closed comments are removed, unclosed ones are kept', () => {
    expect(sanitizePastedHTML('a<!-- x -->b<!-- y')).toBe('ab<!-- y');
  });
  it('markdown with 200k trailing spaces is trimmed in linear time', () => {
    const t = Date.now();
    expect(normalizeMarkdown('hej' + ' '.repeat(200_000))).toBe('hej');
    expect(Date.now() - t).toBeLessThan(500);
  });
});

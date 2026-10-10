// F036.7 — moved from cardmem apps/agent/src/lens/testid-gaps.test.ts @ cc3ad9e, assertions unchanged:
// the package must prove the SAME behaviour the daemon had. Only the runner (bun:test →
// vitest), the import path and inventoryInteractiveGaps' sandbox argument differ.
// F074.22b — the interactive-testid-gap scanner reported false positives on any
// element whose opening tag spanned multiple lines with an arrow handler
// (`onChange={e => …}`) BEFORE its data-testid: the old /<tag[^>]*>/ regex
// stopped at the '>' inside `=>`, so the data-testid that followed was never
// seen. This broke the fleet-wide F086 self-check (sessions couldn't prove they
// closed gaps). These tests pin the brace/quote-aware tag-end scan.

import { describe, expect, test } from 'vitest';
import { gapsInFile, type TestIdGap } from '../src/testid-gaps';

function gaps(src: string): TestIdGap[] {
  const out: TestIdGap[] = [];
  gapsInFile(src, 'x.tsx', out);
  return out;
}

describe('gapsInFile — multi-line JSX testid detection', () => {
  test('multi-line control with an arrow handler BEFORE data-testid is NOT a gap (the bug)', () => {
    const src = [
      '<select',
      '  value={hour}',
      '  onChange={e => onHourChange(Number(e.target.value))}',
      '  data-testid="cron-builder-hour"',
      '  className="h-8">',
      '</select>',
    ].join('\n');
    expect(gaps(src)).toHaveLength(0);
  });

  test('multi-line control with an arrow handler and NO testid IS a gap', () => {
    const src = [
      '<select',
      '  value={hour}',
      '  onChange={e => onHourChange(Number(e.target.value))}',
      '  className="h-8">',
      '</select>',
    ].join('\n');
    const g = gaps(src);
    expect(g).toHaveLength(1);
    expect(g[0]!.element).toBe('select');
    expect(g[0]!.line).toBe(1);
  });

  test('single-line native control without testid IS a gap', () => {
    expect(gaps('<button onClick={f}>Go</button>')).toHaveLength(1);
  });

  test('single-line native control with testid is NOT a gap', () => {
    expect(gaps('<button onClick={f} data-testid="go">Go</button>')).toHaveLength(0);
  });

  test('PascalCase component is never a gap (its DOM is tagged in its own file)', () => {
    expect(gaps('<Select onChange={f}>x</Select>')).toHaveLength(0);
  });

  test("a '>' inside a brace expression (comparison) does not truncate the tag", () => {
    const src = [
      '<input',
      '  onChange={e => { if (e.x > 3) g(); }}',
      '  data-testid="n" />',
    ].join('\n');
    expect(gaps(src)).toHaveLength(0);
  });

  test('a testid inside a string value elsewhere is still correctly matched per element', () => {
    // two elements: first tagged, second not → exactly one gap on the second
    const src = [
      '<button onClick={a} data-testid="one">1</button>',
      '<button onClick={b}>2</button>',
    ].join('\n');
    const g = gaps(src);
    expect(g).toHaveLength(1);
    expect(g[0]!.line).toBe(2);
  });
});

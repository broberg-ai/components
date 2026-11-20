// F115.2 — CodeQL js/polynomial-redos on assertColor's rgb()/hsl() pattern.
import { describe, it, expect } from 'vitest';
import { assertColor } from '../src/index';

describe('F115.2 — assertColor on hostile input', () => {
  it('rgb( followed by 100k tabs and no closing paren is refused in linear time', () => {
    const t = Date.now();
    expect(() => assertColor('brand', 'rgb(' + '\t'.repeat(100_000) + 'x')).toThrow();
    expect(Date.now() - t).toBeLessThan(500);
  });
  it('still accepts the real forms', () => {
    for (const v of ['#123456', 'rgb(1, 2, 3)', 'rgba( 1 , 2 , 3 , .5 )', 'hsl(120 50% 50%)', 'red']) expect(() => assertColor('c', v)).not.toThrow();
  });
});

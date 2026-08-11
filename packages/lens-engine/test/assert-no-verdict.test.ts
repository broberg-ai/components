import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { evalAssertBody, noVerdictMessage, type AssertOutcome } from '../src/flow';

/**
 * F066 — an assert that returns a plain object with no `pass` key asserted
 * NOTHING, and passed anyway.
 *
 * F064 taught the engine to read `.pass` when the returned object carries one,
 * and to keep bare-truthy behaviour otherwise so that
 * `assert: document.querySelector('#drawer.open')` — which returns an Element —
 * keeps working. That fallback is right, but it swallowed a second false green:
 *
 *     return { passed: drawer.classList.contains('open'), detail: '…' }
 *                ^^^^^^ not `pass`
 *
 * No `pass` key ⇒ bare-truthy ⇒ green forever, whatever the drawer does.
 *
 * Measured in cardmem's real two-month history (17 unique bodies): 2 are this
 * class. The worse of the two computed the answer and then returned it as a data
 * field instead of a verdict — see the `picker_left` case at the bottom.
 *
 * The discriminator is the prototype: a DOM Element is not a plain object.
 */

/** What the flow step does with an outcome, mirrored so the mapping is asserted too. */
function verdict(out: AssertOutcome): 'pass' | 'fail' | 'error' {
  if (out.kind === 'syntax' || out.kind === 'threw' || out.kind === 'no-verdict') return 'error';
  return out.value ? 'pass' : 'fail';
}

describe('a plain object with no `pass` key is not a verdict', () => {
  it('is rejected, and the outcome NAMES every key it carried', async () => {
    const out = await evalAssertBody("({ passed: 1 < 2, detail: 'drawer open' })");
    expect(out.kind).toBe('no-verdict');
    expect((out as { keys: string[] }).keys).toEqual(['passed', 'detail']);
    expect(verdict(out)).toBe('error');
  });

  it('names the keys for the descriptive-key case too — the one no reviewer stops at', async () => {
    // `{found: …}` is not a typo. It is someone who assumed the key had a
    // descriptive name, and it looks MORE careful than a bare boolean, which is
    // precisely why it survives review.
    const out = await evalAssertBody("return { found: true, id: 'x' }");
    expect(out.kind).toBe('no-verdict');
    expect((out as { keys: string[] }).keys).toEqual(['found', 'id']);
  });

  it('an EMPTY object is reported as its own case — there is no key to suggest renaming', async () => {
    for (const body of ['({})', 'return {}', 'return Object.create(null)']) {
      const out = await evalAssertBody(body);
      expect(out.kind).toBe('no-verdict');
      expect((out as { keys: string[] }).keys).toEqual([]);
    }
  });
});

describe('noVerdictMessage — ONE definition of the two sentences (0.6.1)', () => {
  // cardmem surfaces this outcome on their daemon flow-path AND their verify
  // path, and had rebuilt the wording by hand in both. Two copies of a message
  // drift exactly like the two copies of the verdict logic that caused F064.
  it('names the keys, in order, and suggests `pass`', () => {
    const m = noVerdictMessage(['found', 'id']);
    expect(m).toContain('found, id');
    expect(m).toContain('did you mean { pass }');
  });

  it('the empty case is a DIFFERENT sentence and never suggests a rename', () => {
    const m = noVerdictMessage([]);
    expect(m).toContain('nothing was asserted');
    expect(m).toContain('template that was never filled in');
    expect(m).not.toContain('did you mean');
  });

  it('appends the offending body only when one is supplied', () => {
    expect(noVerdictMessage(['a'], 'return {a:1}')).toContain('return {a:1}');
    expect(noVerdictMessage(['a'])).not.toContain(':  ');
  });

  it('is what runFlow actually throws — not a parallel copy', async () => {
    // The point of exporting it. If runFlow ever stops calling this, the string
    // it throws and the string a consumer prints part ways silently.
    const out = await evalAssertBody('return { passed: true }');
    expect(out.kind).toBe('no-verdict');
    expect(noVerdictMessage((out as { keys: string[] }).keys)).toContain('passed');
  });
});

describe('the rejection is NARROW — everything else keeps bare-truthy', () => {
  beforeAll(() => {
    const dom = new JSDOM('<!doctype html><html><body><div id="drawer" class="open">x</div></body></html>');
    (globalThis as { document?: Document }).document = dom.window.document as unknown as Document;
  });

  it('REGRESSION GUARD: a real DOM Element still passes', async () => {
    // The reason the bare-truthy fallback exists at all. If this breaks, every
    // `assert: document.querySelector('#x')` in the fleet breaks with it.
    const out = await evalAssertBody("document.querySelector('#drawer.open')");
    expect(out).toEqual({ kind: 'value', value: true });
  });

  it('a real Element is NOT a plain object — the discriminator, stated directly', async () => {
    const el = (globalThis as { document: Document }).document.querySelector('#drawer')!;
    expect(Object.getPrototypeOf(el)).not.toBe(Object.prototype);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('an array still passes', async () => {
    expect(await evalAssertBody('[1,2,3]')).toEqual({ kind: 'value', value: true });
    // …including an EMPTY array, which is truthy in JS and must stay so.
    expect(await evalAssertBody('[]')).toEqual({ kind: 'value', value: true });
  });

  it('a Date and a Map still pass', async () => {
    expect(await evalAssertBody('new Date()')).toEqual({ kind: 'value', value: true });
    expect(await evalAssertBody('new Map()')).toEqual({ kind: 'value', value: true });
  });

  it('a class instance still passes', async () => {
    expect(await evalAssertBody('new (class X { constructor(){ this.a = 1 } })()')).toEqual({
      kind: 'value',
      value: true,
    });
  });

  it('{pass:…} is still a VERDICT, not an error — both ways', async () => {
    expect(await evalAssertBody('({pass:true})')).toEqual({ kind: 'value', value: true });
    expect(await evalAssertBody("({pass:false, detail:'nope'})")).toEqual({
      kind: 'value',
      value: false,
      detail: 'nope',
    });
    // A `pass` key that is present but falsy is a FAIL, never a no-verdict —
    // the author did supply a verdict.
    expect(await evalAssertBody('({pass:undefined, detail:"x"})')).toMatchObject({
      kind: 'value',
      value: false,
    });
  });

  it('primitives are untouched', async () => {
    expect(verdict(await evalAssertBody('1===1'))).toBe('pass');
    expect(verdict(await evalAssertBody('1===2'))).toBe('fail');
    expect(verdict(await evalAssertBody('null'))).toBe('fail');
    expect(verdict(await evalAssertBody('undefined'))).toBe('fail');
    expect(verdict(await evalAssertBody('""'))).toBe('fail');
    expect(verdict(await evalAssertBody('"x"'))).toBe('pass');
  });
});

describe('the 0.5.0 measured table is unchanged', () => {
  it('every degenerate body keeps the verdict it already had', async () => {
    const table: Array<[string, 'pass' | 'fail' | 'error']> = [
      ['', 'fail'],
      ['   ', 'fail'],
      ['\n\t\n', 'fail'],
      ['/* intet */', 'fail'],
      ['// intet', 'error'],
      ['undefined', 'fail'],
      ['null', 'fail'],
      ['true;', 'fail'],
      ['1===1', 'pass'],
      ['1===2', 'fail'],
    ];
    for (const [body, want] of table) {
      expect(verdict(await evalAssertBody(body)), JSON.stringify(body)).toBe(want);
    }
  });
});

/**
 * The real population, not examples I invented. 17 unique assert bodies written
 * by sessions that believed they were proving something, over two months,
 * supplied verbatim by cardmem.
 *
 * The point of testing against it is that it CONTRADICTED the label it arrived
 * with: cardmem's key= tags came from a regex over source text, and a regex
 * cannot see which value a body finally RESOLVES to — an object built inside a
 * `.map()` or a `.then()` is not the return value. Measured, 2 are this class,
 * not 17.
 */
// Committed into the repo (with cardmem's agreement) rather than read from the
// session scratchpad it arrived in: a test that only runs on one Mac is not a
// gate. It does not reach npm — `files` is ["dist","README.md"].
const POPULATION = new URL('./fixtures/cardmem-f066-population.txt', import.meta.url);

describe("cardmem's real population", () => {
  const entries: Array<{ key: string; body: string }> = [];
  let available = false;

  beforeAll(() => {
    let raw = '';
    try {
      raw = readFileSync(POPULATION, 'utf8');
      available = true;
    } catch {
      return; // another session's scratchpad — absent on CI, see the guard below
    }
    let cur: { key: string; body: string } | null = null;
    for (const line of raw.split('\n')) {
      const h = line.match(/^###\s+key=(.+?)\s+site=/);
      if (h) {
        if (cur) entries.push(cur);
        cur = { key: h[1]!, body: '' };
      } else if (cur && line.trim()) {
        cur.body += (cur.body ? '\n' : '') + line;
      }
    }
    if (cur) entries.push(cur);

    const dom = new JSDOM(`<!doctype html><html><body>
      <div data-testid="reader-root"><h1>Overskrift</h1></div>
      <div data-testid="session-tab-picker"></div><div data-testid="sidebar-root"></div>
    </body></html>`);
    const w = globalThis as Record<string, unknown>;
    // `window` matters: four of these bodies stash state on it (`window.__done`,
    // `window.__seti`, …) and without it they throw instead of resolving, which
    // silently changes the counts below.
    w.window = dom.window;
    w.document = dom.window.document;
    w.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    w.fetch = async () => ({ status: 200, json: async () => ({ rules: [] }), text: async () => '{}' });
  });

  it('exactly the two data-collection asserts are rejected; nothing else changes', async () => {
    if (!available) {
      // Do not silently pass when the fixture is missing — that would be the
      // empty-test failure this whole epic is about. Fail loudly instead.
      expect.fail(`population fixture not readable at ${POPULATION} — cannot verify this AC`);
    }
    expect(entries).toHaveLength(17);

    const rejected: string[] = [];
    for (const e of entries) {
      const out = await evalAssertBody(e.body);
      if (out.kind === 'no-verdict') rejected.push((out as { keys: string[] }).keys.join(','));
    }

    // #1 reads typography into a bag of fields; #17 computes `behind` — the
    // answer — and then hands it back as a data field instead of a verdict.
    expect(rejected).toEqual([
      'text,fontFamily,fontSize,fontWeight,letterSpacing',
      'picker_left,sidebar_right,behind',
    ]);
  });

  it('the dominant always-green pattern in that data is NOT this class — 0.6.0 does not fix it', async () => {
    // 8 of 17 end a fetch chain with `return true`, which is green whatever the
    // page did. Recording it here so the number is not mistaken for a claim that
    // this release cleans up that population.
    let resolvesTrue = 0;
    for (const e of entries) {
      const out = await evalAssertBody(e.body);
      if (out.kind === 'value' && out.value === true) resolvesTrue++;
    }
    // Measured, not guessed: these hand back a literal `true` at the end of a
    // fetch chain, so they are green whatever the page did. A separate class,
    // untouched by this release.
    expect(resolvesTrue).toBe(8);
  });
});

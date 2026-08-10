import { describe, expect, it } from 'vitest';
import { evalAssertBody, type AssertOutcome } from '../src/flow';

/**
 * F064 — the assert step could not fail.
 *
 * `page.evaluate(step.js)` evaluated the body as an EXPRESSION and the check was
 * `if (!result)`. Every object is truthy, so `{ pass:false }` — the documented
 * form — passed permanently, and `return …` was a SyntaxError.
 *
 * Filed by cardmem (#19259) with three probes measured against the RUNNING
 * engine through their daemon's /lens/flow. Those three are the first three
 * tests below; the rest surround them.
 *
 * `evalAssertBody` is pure and self-contained (only its argument + globals), so
 * it unit-tests here exactly as it behaves once serialised into the page — one
 * definition, both sides, same as `isEditableElement`.
 */

/** What the flow step does with an outcome, mirrored so the mapping is asserted too. */
function verdict(out: AssertOutcome): 'pass' | 'fail' {
  if (out.kind === 'syntax' || out.kind === 'threw') return 'fail';
  return out.value ? 'pass' : 'fail';
}

describe("cardmem's three measured probes", () => {
  it('PROBE 1 — ({pass:false}) FAILS (was: passed, the false green)', async () => {
    const out = await evalAssertBody('({pass:false})');
    expect(out).toMatchObject({ kind: 'value', value: false });
    expect(verdict(out)).toBe('fail');
  });

  it('PROBE 2 — false still fails, and is a VERDICT not a crash (the discriminator)', async () => {
    const out = await evalAssertBody('false');
    expect(out.kind).toBe('value'); // ran and returned — not syntax, not threw
    expect(verdict(out)).toBe('fail');
  });

  it('PROBE 3 — `return …` PASSES (was: SyntaxError, Illegal return statement)', async () => {
    const out = await evalAssertBody('return 1 + 1 === 2');
    expect(out).toEqual({ kind: 'value', value: true });
    expect(verdict(out)).toBe('pass');
  });
});

describe('the { pass, detail } form is honoured, not banned', () => {
  it('{pass:true} passes', async () => {
    expect(await evalAssertBody('({pass:true})')).toEqual({ kind: 'value', value: true });
  });

  it("carries the author's detail out so the report can quote it", async () => {
    const out = await evalAssertBody("({pass:false, detail:'expected 3 rows, got 0'})");
    expect(out).toEqual({ kind: 'value', value: false, detail: 'expected 3 rows, got 0' });
  });

  it('stringifies a non-string detail rather than dropping it', async () => {
    const out = await evalAssertBody('({pass:false, detail:{rows:0}})');
    expect(out).toMatchObject({ kind: 'value', value: false });
    expect((out as { detail?: string }).detail).toContain('rows');
  });

  it('a truthy object WITHOUT pass still passes — existing asserts are not broken', async () => {
    // The shape `document.querySelector('#x')` returns. Banning objects would
    // have broken working asserts in order to fix broken ones.
    const out = await evalAssertBody('({tagName:"BODY"})');
    expect(out).toEqual({ kind: 'value', value: true });
  });

  it('pass is coerced, so {pass:1} and {pass:0} behave', async () => {
    expect(await evalAssertBody('({pass:1})')).toEqual({ kind: 'value', value: true });
    expect(await evalAssertBody('({pass:0})')).toEqual({ kind: 'value', value: false });
  });
});

describe('await works — both wrappers are async', () => {
  it('in an expression body', async () => {
    expect(await evalAssertBody('await Promise.resolve(true)')).toEqual({ kind: 'value', value: true });
  });

  it('in a statement body', async () => {
    const out = await evalAssertBody('const v = await Promise.resolve(2); return v === 2');
    expect(out).toEqual({ kind: 'value', value: true });
  });
});

describe('three outcomes stay distinct — "false", "threw" and "never ran" are different sentences', () => {
  it('an uncompilable body reports SYNTAX, not falsy', async () => {
    const out = await evalAssertBody('=== 5');
    expect(out.kind).toBe('syntax');
    expect((out as { message: string }).message.length).toBeGreaterThan(0);
  });

  it('a body that throws reports THREW with the message, not falsy', async () => {
    const out = await evalAssertBody('(() => { throw new Error("boom") })()');
    expect(out).toMatchObject({ kind: 'threw', message: 'boom' });
  });

  it('a reference to something absent reports THREW, not falsy', async () => {
    // The difference that matters in practice: "your predicate is false" would
    // send an author looking at the app; "threw" sends them to the predicate.
    const out = await evalAssertBody('nonExistentGlobal.field === 1');
    expect(out.kind).toBe('threw');
  });

  it('a rejected promise reports THREW', async () => {
    const out = await evalAssertBody('await Promise.reject(new Error("nope"))');
    expect(out).toMatchObject({ kind: 'threw', message: 'nope' });
  });
});

describe('nothing crosses the boundary that cannot be cloned', () => {
  it('a circular detail does not explode the step', async () => {
    // JSON.stringify throws on a cycle; the catch must fall back to String().
    const out = await evalAssertBody(
      'const o = {pass:false}; const d = {}; d.self = d; o.detail = d; return o',
    );
    expect(out).toMatchObject({ kind: 'value', value: false });
    expect(typeof (out as { detail?: string }).detail).toBe('string');
  });

  it('a statement body that forgets to return asserts NOTHING — and fails', async () => {
    // Caught while writing the test above: without `return`, the block wrapper
    // yields undefined. Failing is the safe reading — you asserted nothing —
    // but it must be a deliberate, tested choice rather than an accident of
    // truthiness, because an accidental PASS here is the very bug F064 fixes.
    const out = await evalAssertBody('const o = {pass:true}; o');
    expect(out).toEqual({ kind: 'value', value: false });
    expect(verdict(out)).toBe('fail');
  });

  it('every returned outcome is structured-clone safe', async () => {
    for (const body of ['({pass:false, detail:{a:1}})', 'false', '=== 5', 'throwsUndefined()']) {
      const out = await evalAssertBody(body);
      expect(() => structuredClone(out)).not.toThrow();
    }
  });
});

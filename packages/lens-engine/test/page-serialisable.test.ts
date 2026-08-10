import { describe, expect, it } from 'vitest';
import { evalAssertBody, isEditableElement } from '../src/flow';

/**
 * F064.2 — the seal no other test in this repo can provide.
 *
 * `page.evaluate(fn, arg)` / `locator.evaluate(fn)` do NOT send a closure. They
 * serialise the function to SOURCE and re-evaluate it inside the browser. A
 * page-serialised function may therefore reference only its own arguments, its
 * own locals, and browser globals — nothing from module scope.
 *
 * ⚠️  A DIRECT CALL CANNOT DETECT A VIOLATION. Every other test here imports
 * these functions and calls them, so module scope is present and an outside
 * reference resolves happily. Add a module-scope helper tomorrow and the whole
 * suite stays green — and the first real flow run throws
 * `ReferenceError: helper is not defined`, in a browser, on someone else's
 * machine. Raised by cardmem (#19270), who checked the property by reading our
 * built dist rather than our source.
 *
 * So we do what the runtime does: rebuild each function from its own source and
 * call the rebuilt copy, which has no access to this module.
 *
 * DO NOT "simplify" this file away because it looks like it re-tests functions
 * already covered above. The subject here is not the behaviour — it is the
 * absence of a closure.
 */

/** Rebuild a function from its own source, detached from module scope — what page.evaluate does. */
function detach<T extends (...args: never[]) => unknown>(fn: T): T {
  return new Function(`return (${fn.toString()})`)() as T;
}

describe('the seal can actually fire', () => {
  it('a function that reaches outside itself throws ReferenceError once detached', () => {
    // Deliberately offending: `OUTSIDE` lives in this module, not in the function.
    const OUTSIDE = 42;
    const offender = () => OUTSIDE > 0;

    expect(offender()).toBe(true); // a direct call is FINE — this is the blind spot
    expect(() => detach(offender)()).toThrow(ReferenceError); // detached, it cannot resolve
  });
});

describe('evalAssertBody is page-serialisable', () => {
  const detached = detach(evalAssertBody);

  it('survives being rebuilt from its own source', async () => {
    await expect(detached('true')).resolves.toEqual({ kind: 'value', value: true });
  });

  it("behaves identically to the imported copy on cardmem's three probes", async () => {
    for (const body of ['({pass:false})', 'false', 'return 1 + 1 === 2']) {
      expect(await detached(body)).toEqual(await evalAssertBody(body));
    }
  });

  it('still honours { pass, detail } when detached', async () => {
    await expect(detached("({pass:false, detail:'expected 3 rows, got 0'})")).resolves.toEqual({
      kind: 'value',
      value: false,
      detail: 'expected 3 rows, got 0',
    });
  });

  it('still reports syntax and threw distinctly when detached', async () => {
    expect((await detached('=== 5')).kind).toBe('syntax');
    expect((await detached('(() => { throw new Error("boom") })()')).kind).toBe('threw');
  });
});

describe('isEditableElement is page-serialisable', () => {
  // Serialised via locator.evaluate — same exposure, same missing test until now.
  const detached = detach(isEditableElement);

  /** Minimal stand-ins: the function only touches tagName / attributes / parentElement. */
  const el = (tag: string, attrs: Record<string, string> = {}, parent: unknown = null) =>
    ({
      tagName: tag,
      getAttribute: (n: string) => attrs[n] ?? null,
      parentElement: parent,
      disabled: false,
      readOnly: false,
    }) as unknown as Element;

  it('survives being rebuilt from its own source', () => {
    expect(() => detached(el('DIV'))).not.toThrow();
  });

  it('behaves identically to the imported copy', () => {
    const cases: Element[] = [
      el('DIV'),
      el('DIV', { contenteditable: 'true' }),
      el('DIV', { contenteditable: 'false' }),
      el('INPUT'),
      el('SELECT'),
      el('SPAN', {}, el('DIV', { contenteditable: 'true' })),
    ];
    for (const c of cases) expect(detached(c)).toBe(isEditableElement(c));
  });
});

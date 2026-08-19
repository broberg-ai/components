// F073.2 — `check` and `uncheck` are real, idempotent, state-asserting verbs.
//
// They were ALIAS on reasoning and GAP on measurement, and only executing them
// found it. cardmem ran every alias candidate in a real browser with two
// checkboxes in OPPOSITE starting states:
//
//   check    box was OFF     → expect ON        action ok · assert ok    ALIAS
//   check    box ALREADY ON  → expect still ON  action ok · assert FAIL  GAP
//   uncheck  box was ON      → expect OFF       action ok · assert ok    ALIAS
//   uncheck  box ALREADY OFF → expect still OFF action ok · assert FAIL  GAP
//
// THE FINDING IS IN THE action COLUMN: `ok` in both failing rows. The click
// SUCCEEDED; only the assertion caught that the resulting state was inverted.
//
// WHAT THESE TESTS CAN AND CANNOT PROVE, said plainly. Idempotence is
// Playwright's contract — check() reads isChecked() first and returns if already
// in the desired state — and proving it needs a real checkbox in a real browser,
// which is cardmem's arm. What is OURS is that the verb drives .check()/.uncheck()
// and NEVER a click, that a refusal is not repaired by falling back, and that the
// failure names the element it actually found.
//
// AND A `<label>` IS NOT A REFUSAL — measured in a real browser after the first
// version of this file assumed it was. Playwright follows the label→control
// association, so a testid on a <label> (wrapping, or for="…") drives the box
// fine; what refuses is a wrapper with no label semantics, or a <label>
// associated with nothing checkable. A FAKE CANNOT KNOW THAT: the association
// lives in the browser's HTML semantics, not in the locator API. So these tests
// drive the hint MECHANISM with an element Playwright really does refuse, and the
// label fact is pinned where it belongs — in cardmem's browser matrix.
import { describe, it, expect } from 'vitest';
import { execStep, describeElement } from '../src/flow.js';
import type { FlowStep } from '../src/schema.js';
import type { Page } from 'playwright';

type Call = { method: string; timeout?: number };

/** `fails` makes check/uncheck throw with Playwright's own wording. `el` is what
 *  evaluate() hands the page-serialisable describer. */
function fakePage(opts: { fails?: string; el?: Record<string, string> } = {}) {
  const calls: Call[] = [];
  const rec = (method: string, o?: { timeout?: number }) => {
    calls.push({ method, timeout: o?.timeout });
    if (opts.fails && (method === 'check' || method === 'uncheck')) throw new Error(opts.fails);
  };
  const el = opts.el ?? { tagName: 'INPUT', type: 'checkbox', 'data-testid': 'agree' };
  const locator: Record<string, unknown> = {
    first: () => locator,
    nth: () => locator,
    count: async () => 1,
    isVisible: async () => true,
    click: async (o?: { timeout?: number }) => rec('click', o),
    check: async (o?: { timeout?: number }) => rec('check', o),
    uncheck: async (o?: { timeout?: number }) => rec('uncheck', o),
    waitFor: async (o?: { timeout?: number }) => rec('waitFor', o),
    // Run the page-serialisable function for real, against a stand-in element.
    evaluate: async (fn: (e: unknown) => unknown) =>
      fn({ tagName: el.tagName, getAttribute: (a: string) => el[a] ?? null }),
  };
  const page = { locator: () => locator, getByTestId: () => locator } as unknown as Page;
  return { page, calls };
}

const step = (action: 'check' | 'uncheck', target: unknown = '#agree') =>
  ({ action, target }) as unknown as FlowStep;

describe('F073.2 — the verb drives the control, it does not click it', () => {
  it('check calls .check() and NEVER .click()', async () => {
    const { page, calls } = fakePage();
    await execStep(page, step('check'), 'https://example.com', 1234);
    expect(calls.map((c) => c.method)).toEqual(['check']);
  });

  it('uncheck calls .uncheck() and NEVER .click()', async () => {
    const { page, calls } = fakePage();
    await execStep(page, step('uncheck'), 'https://example.com', 1234);
    expect(calls.map((c) => c.method)).toEqual(['uncheck']);
  });

  it('the caller’s timeout reaches the verb', async () => {
    const { page, calls } = fakePage();
    await execStep(page, step('check'), 'https://example.com', 1234);
    expect(calls.filter((c) => c.timeout !== 1234)).toEqual([]);
  });
});

describe('F073.2 — a non-checkable target throws, and says what it found', () => {
  const NOT_CHECKABLE = 'Error: Not a checkbox or radio button';

  it('names the element, and never falls back to a click', async () => {
    // A <div> wrapper, not a <label> — a label is accepted by Playwright and is
    // therefore the wrong example for a refusal.
    const { page, calls } = fakePage({
      fails: NOT_CHECKABLE,
      el: { tagName: 'DIV', 'data-testid': 'agree' },
    });
    await expect(execStep(page, step('check'), 'https://example.com', 1234)).rejects.toThrow(
      /<div data-testid="agree">/,
    );
    // THE HALF THAT MATTERS: no click was issued. A fallback would report ok and
    // leave the box in the opposite state — the exact defect that made this a gap.
    expect(calls.map((c) => c.method)).toEqual(['check']);
  });

  it('the hint explains why there is no fallback, not just that it failed', async () => {
    const { page } = fakePage({ fails: NOT_CHECKABLE, el: { tagName: 'DIV' } });
    await expect(execStep(page, step('check'), 'https://example.com', 1234)).rejects.toThrow(
      /throws instead of falling back/,
    );
  });

  it('NEGATIVE CONTROL: an ordinary timeout gets no checkbox lecture', async () => {
    // A hint that fires on every failure is a hint nobody reads — the same rule
    // F071.2's bare-tag hint was built to obey.
    const { page } = fakePage({ fails: 'Timeout 1234ms exceeded', el: { tagName: 'INPUT', type: 'checkbox' } });
    const err: Error = await execStep(page, step('check'), 'https://example.com', 1234).then(
      () => {
        throw new Error('expected the step to fail');
      },
      (e: unknown) => e as Error,
    );
    expect(err.message).toContain('Timeout 1234ms exceeded');
    expect(err.message).not.toContain('falling back');
  });

  it('the hint does NOT tell a label-targeting caller to move their testid', async () => {
    // The correction that matters. The first version of this message said "a
    // <label> or a wrapper will not do", which is false — and false in the GREEN
    // direction: it promised a throw that never comes, so someone whose testid
    // sits on a label would have believed themselves caught by a trap they were
    // not in and moved an attribute for no reason.
    const { page } = fakePage({ fails: NOT_CHECKABLE, el: { tagName: 'DIV' } });
    const err: Error = await execStep(page, step('check'), 'https://example.com', 1234).then(
      () => {
        throw new Error('expected the step to fail');
      },
      (e: unknown) => e as Error,
    );
    expect(err.message).toMatch(/<label> is fine/);
    expect(err.message).toMatch(/label→control association/);
  });

  it('NEGATIVE CONTROL: Playwright’s own message is kept, not replaced', async () => {
    const { page } = fakePage({ fails: NOT_CHECKABLE, el: { tagName: 'DIV' } });
    const err: Error = await execStep(page, step('check'), 'https://example.com', 1234).then(
      () => {
        throw new Error('expected the step to fail');
      },
      (e: unknown) => e as Error,
    );
    expect(err.message).toContain('Not a checkbox or radio button');
  });
});

describe('describeElement — page-serialisable, and it names the useful attributes', () => {
  const el = (tagName: string, attrs: Record<string, string> = {}) =>
    ({ tagName, getAttribute: (a: string) => attrs[a] ?? null }) as unknown as Element;

  it('renders tag + type + role + data-testid, in that order', () => {
    expect(describeElement(el('INPUT', { type: 'checkbox', 'data-testid': 'agree' }))).toBe(
      '<input type="checkbox" data-testid="agree">',
    );
    expect(describeElement(el('INPUT', { type: 'radio', role: 'radio' }))).toBe('<input type="radio" role="radio">');
  });

  it('a bare element renders without an empty attribute list', () => {
    expect(describeElement(el('DIV'))).toBe('<div>');
  });

  it('an empty attribute VALUE is kept — it is not the same as absent', () => {
    // getAttribute returns "" for `data-testid=""`, which is falsy. Dropping it
    // would report <label> for an element that actually carries the attribute,
    // sending the reader looking for a testid that is right there and blank.
    expect(describeElement(el('LABEL', { 'data-testid': '' }))).toBe('<label data-testid="">');
  });
});

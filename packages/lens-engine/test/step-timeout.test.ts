// F071.1 — the per-step timeout, proven where it was actually lost.
//
// F074.51: a caller asked for timeout_ms:1000 and got "Timeout 15000ms exceeded"
// — a number nobody chose. storeform spent two days believing Google Play
// Console was slow. The value was accepted at the API boundary and never reached
// Playwright.
//
// So the assertion that matters is not "we passed the argument somewhere" (a
// test of that shape would have stayed green through all two days) but "the
// number the CALLER chose is the number the Playwright call received". This
// drives execStep with a fake Page and reads the options off every locator call,
// which is exactly the boundary where it went missing.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { execStep, resolveStepTimeout } from '../src/flow.js';
import { flowStepSchema } from '../src/schema.js';
import type { FlowStep } from '../src/schema.js';
import type { Page } from 'playwright';

type Call = { method: string; timeout?: number };

/** A Page that does nothing but record what it was asked to wait for. */
function fakePage(onCall?: (c: Call) => void) {
  const calls: Call[] = [];
  const rec = (method: string, o?: { timeout?: number }) => {
    const c = { method, timeout: o?.timeout };
    calls.push(c);
    onCall?.(c);
  };
  const locator: Record<string, unknown> = {
    first: () => locator,
    click: async (o?: { timeout?: number }) => rec('click', o),
    fill: async (_v: string, o?: { timeout?: number }) => rec('fill', o),
    pressSequentially: async (_t: string, o?: { timeout?: number }) => rec('pressSequentially', o),
    press: async (_k: string, o?: { timeout?: number }) => rec('press', o),
    selectOption: async (_v: unknown, o?: { timeout?: number }) => rec('selectOption', o),
    setInputFiles: async (_f: unknown, o?: { timeout?: number }) => rec('setInputFiles', o),
    waitFor: async (o?: { timeout?: number }) => rec('waitFor', o),
    scrollIntoViewIfNeeded: async (o?: { timeout?: number }) => rec('scrollIntoViewIfNeeded', o),
    innerText: async () => 'hello world',
    evaluate: async () => true,
    screenshot: async () => Buffer.alloc(0),
  };
  const page = {
    locator: () => locator,
    goto: async (_u: string, o?: { timeout?: number }) => rec('goto', o),
    waitForTimeout: async () => {},
    evaluate: async () => {},
    keyboard: { press: async () => {} },
    screenshot: async () => Buffer.alloc(0),
  };
  return { page: page as unknown as Page, calls };
}

/** One step per action that actually hands a timeout to Playwright. The domain
 *  is checked against the union below, so a 14th action cannot slip past by
 *  simply not being listed here — the same trap that let the original defect
 *  ship. `assert` is the one deliberate exclusion: it runs through
 *  page.evaluate(), which takes no timeout option. */
const EXERCISED: Record<string, FlowStep> = {
  goto: { action: 'goto', url: '/x' },
  click: { action: 'click', target: '#a' },
  fill: { action: 'fill', target: '#a', value: 'v' },
  type: { action: 'type', target: '#a', text: 't' },
  press: { action: 'press', key: 'Enter', target: '#a' },
  select: { action: 'select', target: '#a', value: 'v' },
  upload: {
    action: 'upload',
    target: '#a',
    files: [{ name: 'f.txt', content_base64: Buffer.from('hi').toString('base64') }],
  },
  waitFor: { action: 'waitFor', target: '#a' },
  expectText: { action: 'expectText', target: '#a', text: 'hello' },
  expectVisible: { action: 'expectVisible', target: '#a' },
  expectEditable: { action: 'expectEditable', target: '#a' },
  screenshot: { action: 'screenshot', target: '#a' },
};
const NO_TIMEOUT_BY_DESIGN = ['assert'];

describe('the number the caller chose is the number Playwright receives', () => {
  it('covers every action in the union', () => {
    const declared = [...Object.keys(EXERCISED), ...NO_TIMEOUT_BY_DESIGN].sort();
    const actual = flowStepSchema.options.map((o) => o.shape.action.value as string).sort();
    expect(declared).toEqual(actual);
  });

  it.each(Object.keys(EXERCISED))('%s hands 1234ms straight through', async (action) => {
    const { page, calls } = fakePage();
    await execStep(page, EXERCISED[action]!, 'https://example.com', 1234);
    // Not "at least one call had 1234" — EVERY call must. One wait quietly
    // running on a different number is the whole bug.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.timeout !== 1234)).toEqual([]);
  });

  it('…and a different number is genuinely carried, not hardcoded', async () => {
    // The control for the control: if execStep ignored its argument and always
    // stamped 1234, every case above would still pass.
    const { page, calls } = fakePage();
    await execStep(page, EXERCISED.click!, 'https://example.com', 777);
    expect(calls.map((c) => c.timeout)).toEqual([777]);
  });
});

describe('precedence: step beats flow beats the built-in default', () => {
  it('the step wins when both are set', () => {
    expect(resolveStepTimeout({ timeout_ms: 1000 }, { timeout_ms: 5000 })).toBe(1000);
  });

  it('the flow applies to a step that sets none', () => {
    expect(resolveStepTimeout({}, { timeout_ms: 5000 })).toBe(5000);
  });

  it('the step applies when the flow sets none', () => {
    expect(resolveStepTimeout({ timeout_ms: 1000 }, {})).toBe(1000);
  });

  it('NEGATIVE CONTROL: neither set = the built-in 30s, unchanged', () => {
    // Without this, "always use the caller's 1000ms" would satisfy every test
    // above while silently changing behaviour for every existing flow.
    expect(resolveStepTimeout({}, {})).toBe(30_000);
  });

  it('the resolved value is what actually reaches Playwright', async () => {
    // Ties the two halves together: the precedence rule is only worth anything
    // if its answer is the number that travels.
    const { page, calls } = fakePage();
    const t = resolveStepTimeout({ timeout_ms: 1000 }, { timeout_ms: 5000 });
    await execStep(page, EXERCISED.click!, 'https://example.com', t);
    expect(calls.map((c) => c.timeout)).toEqual([1000]);
  });
});

describe('the default has exactly one definition', () => {
  it('DEFAULT_TIMEOUT_MS is declared once and read once, inside resolveStepTimeout', () => {
    // Added because the mutation pass found this undefended: closing the inlet
    // again broke the implicit lead navigation (a flow whose body sets
    // timeout_ms but opens without its own `goto`) and NOT ONE TEST FAILED.
    // runFlow's wiring cannot be exercised without a browser, so the property
    // asserted here is the one that actually prevents it — the precedence rule
    // exists in ONE place, so there is no second copy to drift.
    //
    // Two copies of a rule is how the daemon and the engine ended up with two
    // different grammars in the first place (F073).
    const src = readFileSync(new URL('../src/flow.ts', import.meta.url), 'utf8');
    const uses = src.match(/DEFAULT_TIMEOUT_MS/g) ?? [];
    expect(uses.length).toBe(2); // the `const …` declaration + the one read
    expect(src).toContain('return step.timeout_ms ?? flow.timeout_ms ?? DEFAULT_TIMEOUT_MS;');
  });
});

describe('the F074.51 symptom cannot be reproduced from this layer', () => {
  it('a timeout failure reports the caller’s number, not a substituted one', async () => {
    // Playwright words the message from the timeout it was GIVEN. The engine's
    // job is to not rewrite it — F074.51 is what a substituted number looks like
    // from the outside ("Timeout 15000ms exceeded" for a 1000ms request).
    const { page } = fakePage((c) => {
      if (c.method === 'click') throw new Error(`Timeout ${c.timeout}ms exceeded.`);
    });
    await expect(execStep(page, EXERCISED.click!, 'https://example.com', 1000)).rejects.toThrow(
      'Timeout 1000ms exceeded.',
    );
  });

  it('and the number in that message tracks the request', async () => {
    // The negative control: if the assertion above merely matched a constant,
    // this would fail.
    const { page } = fakePage((c) => {
      if (c.method === 'click') throw new Error(`Timeout ${c.timeout}ms exceeded.`);
    });
    await expect(execStep(page, EXERCISED.click!, 'https://example.com', 2500)).rejects.toThrow(
      'Timeout 2500ms exceeded.',
    );
  });
});

describe('timeout_ms: 0 is refused rather than silently inverted', () => {
  it('rejects 0, which Playwright reads as "no timeout at all"', () => {
    // A caller writing 0 means "fail immediately". Playwright reads timeout:0 as
    // "wait forever" — the exact inversion this field exists to prevent, so it
    // never gets to be expressed.
    expect(flowStepSchema.safeParse({ action: 'click', target: '#a', timeout_ms: 0 }).success).toBe(false);
    expect(flowStepSchema.safeParse({ action: 'click', target: '#a', timeout_ms: 1 }).success).toBe(true);
  });
});

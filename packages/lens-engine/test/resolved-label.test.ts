// F071.6 — the label named the spec's first key, not the layer that hit.
//
// Filed by cardmem, and the way it was found is worth more than the fix. Setting
// out to prove F071.5's defect on 0.8.0, they read the step's `detail` and
// reported "4/4 resolved to TESTID" — the reassurance that nearly let a real bug
// stand. The raw step said both things at once:
//
//   "detail":       "by-testid ⊇ \"WINNER\""     ← built from the spec's FIRST key
//   "resolved_via": "css"                         ← the layer that actually hit
//
// THE PROPERTY THAT MADE IT DANGEROUS is not that the label was imprecise. It was
// constructed from the REQUEST, so it could never contradict the caller. A field
// that cannot disagree with you looks like confirmation and carries nothing.
import { describe, it, expect } from 'vitest';
import { execStep } from '../src/flow.js';
import type { FlowStep } from '../src/schema.js';
import type { Page } from 'playwright';

/** Only the named layers match anything. */
function page(present: string[]) {
  const leaf = (key: string) => {
    const hit = present.includes(key);
    return {
      nth: () => leaf(key),
      first: () => leaf(key),
      count: async () => (hit ? 1 : 0),
      isVisible: async () => hit,
      waitFor: async () => {
        if (!hit) throw new Error('never');
      },
      click: async () => {},
      fill: async () => {},
      check: async () => {},
      innerText: async () => 'WINNER',
      evaluate: async () => true,
      scrollIntoViewIfNeeded: async () => {},
      screenshot: async () => Buffer.alloc(0),
    };
  };
  return {
    locator: () => leaf('css'),
    getByTestId: () => leaf('testid'),
    getByRole: () => leaf('role'),
    getByLabel: () => leaf('label'),
    getByPlaceholder: () => leaf('placeholder'),
    getByText: () => leaf('text'),
    waitForTimeout: async () => {},
  } as unknown as Page;
}

const SPEC = { testid: 'by-testid', css: '#by-css', text: 'WINNER' };

describe('F071.6 — the label names the layer that hit', () => {
  it('the exact case cardmem read wrong: resolved via css, labelled by-testid', async () => {
    const r = await execStep(
      page(['css']),
      { action: 'click', target: SPEC } as unknown as FlowStep,
      'https://example.com',
      1_000,
    );
    expect(r.resolved_via).toBe('css');
    expect(r.detail).toBe('#by-css (css)');
    // The old label. If this ever comes back, the field lies again.
    expect(r.detail).not.toBe('by-testid');
  });

  it('THE PROPERTY: the label and resolved_via cannot disagree', async () => {
    // Driven across every layer, so the guard is not one hand-picked case.
    for (const layer of ['testid', 'css', 'text'] as const) {
      const r = await execStep(
        page([layer]),
        { action: 'click', target: SPEC } as unknown as FlowStep,
        'https://example.com',
        1_000,
      );
      expect(r.detail, `${layer} label`).toContain(`(${r.resolved_via})`);
    }
  });

  it('applies to every resolving verb, not just the one that bit', async () => {
    const steps: FlowStep[] = [
      { action: 'fill', target: SPEC, value: 'v' },
      { action: 'check', target: SPEC },
      { action: 'expectText', target: SPEC, text: 'WINNER' },
      { action: 'expectVisible', target: SPEC },
      { action: 'screenshot', target: SPEC },
    ] as unknown as FlowStep[];
    for (const step of steps) {
      const r = await execStep(page(['css']), step, 'https://example.com', 1_000);
      expect(r.detail, `${step.action}`).toContain('#by-css (css)');
    }
  });

  it('a bare STRING target is unchanged — the string IS the selector', async () => {
    // Rewriting it would churn every existing consumer's logs for no information.
    const r = await execStep(
      page(['css']),
      { action: 'click', target: '#save' } as unknown as FlowStep,
      'https://example.com',
      1_000,
    );
    expect(r.detail).toBe('#save');
    expect(r.resolved_via).toBe('selector');
  });

  it('resolved_via itself is untouched, for a spec AND for a string', async () => {
    const spec = await execStep(
      page(['text']),
      { action: 'click', target: SPEC } as unknown as FlowStep,
      'https://example.com',
      1_000,
    );
    expect(spec.resolved_via).toBe('text');
    const str = await execStep(
      page(['css']),
      { action: 'click', target: '#x' } as unknown as FlowStep,
      'https://example.com',
      1_000,
    );
    expect(str.resolved_via).toBe('selector');
  });

  it('a layer whose value cannot be recovered falls back to the old label', async () => {
    // Better a label that says nothing than one that says the wrong thing
    // confidently — which is the entire defect.
    const r = await execStep(
      page(['css']),
      { action: 'click', target: { css: '#only' } } as unknown as FlowStep,
      'https://example.com',
      1_000,
    );
    expect(r.detail).toBe('#only (css)');
  });
});

// F071.4 — a LocateSpec object never waited, and timeout_ms was dead on the form
// the README recommends.
//
// MEASURED BY cardmem in a real browser against 0.7.1, which is why this file
// exists at all. Element injected at t+800ms, 5000ms timeout, against a negative
// control that never injects:
//
//   STRING css     arrives → ok 1124ms   |  never → fail 5377ms
//   OBJECT css     arrives → FAIL 457ms  |  never → fail  331ms
//
// The object form's two columns are INDISTINGUISHABLE: same verdict, same time,
// same message for "not there yet" and "never there". The string form skips the
// probe and lets Playwright auto-wait; the object form gated every layer on
// `await loc.count() > nth`, an instantaneous snapshot.
//
// These tests drive the resolver with a fake Page that models TIME, so the
// behaviour is provable offline. The live confirmation is cardmem's, on both
// runners — a fix proven only here would be proven on the wrong artifact.
import { describe, it, expect } from 'vitest';
import { resolveTarget, execStep, remainingBudget } from '../src/flow.js';
import type { FlowStep } from '../src/schema.js';
import type { Page } from 'playwright';

type Call = { method: string; timeout?: number };

/** A page whose layers appear on a schedule. `at` is ms from construction;
 *  Infinity means never. `hidden` models an element that is ATTACHED but not
 *  visible — the case that separates the two criteria. */
function timedPage(spec: Record<string, { at: number; hidden?: boolean }>, calls: Call[] = []) {
  const t0 = Date.now();
  const leaf = (key: string) => {
    const s = spec[key] ?? { at: Infinity };
    const present = () => Date.now() - t0 >= s.at;
    return {
      isVisible: async () => present() && !s.hidden,
      count: async () => (present() ? 1 : 0),
      async waitFor(o?: { state?: string; timeout?: number }) {
        calls.push({ method: `waitFor:${key}`, timeout: o?.timeout });
        const wantVisible = (o?.state ?? 'visible') === 'visible';
        const deadline = Date.now() + (o?.timeout ?? 30_000);
        for (;;) {
          if (present() && (!wantVisible || !s.hidden)) return;
          if (Date.now() >= deadline) throw new Error(`Timeout ${o?.timeout}ms exceeded waiting for ${key}`);
          await new Promise((r) => setTimeout(r, 10));
        }
      },
      click: async (o?: { timeout?: number }) => void calls.push({ method: 'click', timeout: o?.timeout }),
      setInputFiles: async (_f: unknown, o?: { timeout?: number }) =>
        void calls.push({ method: 'setInputFiles', timeout: o?.timeout }),
      innerText: async () => 'hello',
      evaluate: async () => true,
      scrollIntoViewIfNeeded: async () => {},
      screenshot: async () => Buffer.alloc(0),
    };
  };
  const layer = (key: string) => ({ nth: () => leaf(key), first: () => leaf(key), count: leaf(key).count });
  const page = {
    locator: (_sel: string) => layer('css'),
    getByTestId: () => layer('testid'),
    getByRole: () => layer('role'),
    getByLabel: () => layer('label'),
    getByPlaceholder: () => layer('placeholder'),
    getByText: () => layer('text'),
    goto: async () => {},
    waitForTimeout: async () => {},
    evaluate: async () => {},
    screenshot: async () => Buffer.alloc(0),
    keyboard: { press: async () => {} },
  };
  return { page: page as unknown as Page, calls };
}

const elapsed = async (fn: () => Promise<unknown>) => {
  const t = Date.now();
  try {
    await fn();
  } catch {
    /* the failure IS the measurement here */
  }
  return Date.now() - t;
};

describe('F071.4 — an object target now waits', () => {
  it('resolves an element that arrives LATE, where 0.7.1 gave up immediately', async () => {
    const { page } = timedPage({ css: { at: 200 } });
    const r = await resolveTarget(page, { css: '#late' }, { action: 'click', timeoutMs: 2_000 });
    expect(r.resolved_via).toBe('css');
  });

  it('"not there yet" and "never there" are now DISTINGUISHABLE — the whole defect', async () => {
    // cardmem's control, offline: the two cases must differ in verdict, and the
    // never-case must cost the caller's budget rather than ~300ms.
    const late = await elapsed(() =>
      resolveTarget(timedPage({ css: { at: 150 } }).page, { css: '#x' }, { action: 'click', timeoutMs: 900 }),
    );
    const never = await elapsed(() =>
      resolveTarget(timedPage({}).page, { css: '#x' }, { action: 'click', timeoutMs: 900 }),
    );
    expect(late).toBeLessThan(600);
    expect(never).toBeGreaterThanOrEqual(850);
  });

  it('an element already present costs ~nothing — pass 1 is unchanged', async () => {
    const ms = await elapsed(() =>
      resolveTarget(timedPage({ css: { at: 0 } }).page, { css: '#now' }, { action: 'click', timeoutMs: 5_000 }),
    );
    expect(ms).toBeLessThan(100);
  });
});

describe('F071.4 — one budget, not n × budget', () => {
  it('four layers that all miss cost ONE timeout, not four', async () => {
    // The criterion that rejects the obvious serialise-a-waitFor-per-layer fix.
    // cardmem raised the objection before it was built.
    const ms = await elapsed(() =>
      resolveTarget(
        timedPage({}).page,
        { testid: 'a', css: '#b', label: 'c', text: 'd' },
        { action: 'click', timeoutMs: 500 },
      ),
    );
    expect(ms).toBeGreaterThanOrEqual(450);
    expect(ms).toBeLessThan(1_100); // 4 × 500 would be ~2000
  });

  it('the race resolves as soon as ANY layer appears, even a late low-priority one', async () => {
    const { page } = timedPage({ text: { at: 150 } });
    const r = await resolveTarget(page, { testid: 'a', css: '#b', text: 'd' }, { action: 'click', timeoutMs: 2_000 });
    expect(r.resolved_via).toBe('text');
  });
});

describe('F071.4 — the budget is spent ONCE (F074.51, inside the fix for F074.51)', () => {
  it('the verb waits on what is LEFT, not on the original timeout', async () => {
    const { page, calls } = timedPage({ css: { at: 200 } });
    await execStep(page, { action: 'click', target: { css: '#late' } } as unknown as FlowStep, 'https://e.test', 1_000);
    const click = calls.find((c) => c.method === 'click')!;
    // Resolve burned ~200ms of 1000ms; the click must not get a fresh 1000.
    expect(click.timeout).toBeLessThan(900);
    expect(click.timeout).toBeGreaterThan(0);
  });

  it('a total miss costs ~N wall-clock, not ~2N', async () => {
    // Asserted on the CLOCK, because "we passed the remainder along" is exactly
    // the shape of claim that was true and useless in F074.51.
    const ms = await elapsed(() =>
      execStep(timedPage({}).page, { action: 'click', target: { css: '#never' } } as unknown as FlowStep, 'https://e.test', 600),
    );
    expect(ms).toBeGreaterThanOrEqual(550);
    expect(ms).toBeLessThan(1_100); // 2 × 600 would be ~1200
  });

  it('remainingBudget floors at 1, never 0 — a zero would mean WAIT FOREVER', () => {
    // Third appearance of that inversion in this epic: badge=0 REMOVES the badge,
    // timeout_ms:0 DISABLES the timeout, and remaining=0 would too. Asserted on
    // the named rule rather than by trying to hit the razor edge through a live
    // resolve — a test that can only pass by timing luck is not a guard.
    expect(remainingBudget(1_000, 0)).toBe(1_000);
    expect(remainingBudget(1_000, 400)).toBe(600);
    expect(remainingBudget(1_000, 1_000)).toBe(1); // exactly spent
    expect(remainingBudget(1_000, 5_000)).toBe(1); // overspent
    expect(remainingBudget(1_000, 999)).toBe(1);
  });

  it('and every resolve reports a remainder that can never be 0', async () => {
    const { page } = timedPage({ css: { at: 0 } });
    const r = await resolveTarget(page, { css: '#x' }, { action: 'click', timeoutMs: 500 });
    expect(r.remaining_ms).toBeGreaterThanOrEqual(1);
    expect(r.remaining_ms).toBeLessThanOrEqual(500);
  });

  it('a string target spends nothing — the full budget reaches Playwright', async () => {
    const { page, calls } = timedPage({ css: { at: 0 } });
    await execStep(page, { action: 'click', target: '#save' } as unknown as FlowStep, 'https://e.test', 1_234);
    expect(calls.find((c) => c.method === 'click')!.timeout).toBe(1_234);
  });
});

describe('F071.4 — the criterion is per VERB, and upload is the exception', () => {
  it('upload resolves a HIDDEN file input — a blanket `visible` would break the fleet', async () => {
    // Measured by cardmem: setInputFiles deliberately does not require
    // visibility, and display:none is the standard pattern behind every styled
    // upload control.
    const { page } = timedPage({ css: { at: 0, hidden: true } });
    const r = await resolveTarget(page, { css: '#file' }, { action: 'upload', timeoutMs: 500 });
    expect(r.resolved_via).toBe('css');
  });

  it('click does NOT resolve the same hidden element', async () => {
    const { page } = timedPage({ css: { at: 0, hidden: true } });
    await expect(resolveTarget(page, { css: '#file' }, { action: 'click', timeoutMs: 200 })).rejects.toThrow(
      /no layer matched/,
    );
  });

  it('SELF-HEAL IMPROVES: a hidden first layer now falls through instead of timing out', async () => {
    // On 0.7.1 css matched (count() counts hidden), then the verb timed out.
    const { page } = timedPage({ css: { at: 0, hidden: true }, text: { at: 0 } });
    const r = await resolveTarget(page, { css: '#hidden', text: 'Save' }, { action: 'click', timeoutMs: 500 });
    expect(r.resolved_via).toBe('text');
  });
});

describe('F071.4 — nth waits on the Nth match, not the first', () => {
  it('passes the wait to .nth(n), so a first-match arrival cannot resolve it', async () => {
    const { page, calls } = timedPage({});
    await elapsed(() => resolveTarget(page, { css: '.row', nth: 3 }, { action: 'click', timeoutMs: 200 }));
    // The waitFor that ran came from the nth() leaf, not from the bare layer.
    expect(calls.some((c) => c.method.startsWith('waitFor:'))).toBe(true);
  });
});

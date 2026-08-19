// F071.5 — the race answers WHEN, and 0.8.0 let it answer WHICH.
//
// A LocateSpec's layers are alternative descriptions of ONE element, listed in
// order of reliability: testid → css → role → label → placeholder → text. Pass 2
// of the patient resolve (F071.4) raced every layer with a bare `Promise.any`,
// which settles on whichever check finishes first. Nothing ordered two layers
// that became true in the same instant — and that is the ORDINARY case, because
// one element rendering makes all of its layers true at once.
//
// So the layer that came back depended on which locator's machinery answered a
// few milliseconds sooner. When the layers happen to match DIFFERENT elements,
// that silently acts on the one the caller listed second. Action ok, wrong thing.
//
// The page below models what a real browser does and a lockstep fake cannot: each
// layer carries its own CHECK LATENCY, because getByTestId and locator(css) are
// not the same machinery and do not answer together.
import { describe, it, expect } from 'vitest';
import { resolveTarget } from '../src/flow.js';
import type { Page } from 'playwright';

type LayerSpec = { at: number; lag?: number };

/** `at` = ms from construction until the element exists. `lag` = ms this layer's
 *  own check takes to answer, which is what breaks the tie. */
function racingPage(spec: Record<string, LayerSpec>) {
  const t0 = Date.now();
  const leaf = (key: string) => {
    const s = spec[key] ?? { at: Infinity };
    const lag = s.lag ?? 0;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const present = () => Date.now() - t0 >= s.at;
    return {
      isVisible: async () => {
        await wait(lag);
        return present();
      },
      count: async () => {
        await wait(lag);
        return present() ? 1 : 0;
      },
      async waitFor(o?: { timeout?: number }) {
        const deadline = Date.now() + (o?.timeout ?? 30_000);
        for (;;) {
          if (present()) {
            await wait(lag);
            return;
          }
          if (Date.now() >= deadline) throw new Error(`Timeout ${o?.timeout}ms exceeded waiting for ${key}`);
          await wait(5);
        }
      },
    };
  };
  const layer = (key: string) => ({ nth: () => leaf(key), first: () => leaf(key), count: leaf(key).count });
  return {
    locator: () => layer('css'),
    getByTestId: () => layer('testid'),
    getByRole: () => layer('role'),
    getByLabel: () => layer('label'),
    getByPlaceholder: () => layer('placeholder'),
    getByText: () => layer('text'),
  } as unknown as Page;
}

describe('F071.5 — priority survives the race', () => {
  it('the defect: same instant, wrong settle order — 0.8.0 returns the SECOND layer', async () => {
    // Both layers become true at 200ms. css answers in 5ms, testid in 30ms, so
    // css's promise settles first. `testid` is what the caller listed first.
    const page = racingPage({ testid: { at: 200, lag: 30 }, css: { at: 200, lag: 5 } });
    const r = await resolveTarget(page, { testid: 'save', css: '#save' }, { action: 'click', timeoutMs: 3_000 });
    expect(r.resolved_via).toBe('testid');
  });

  it('holds across four layers settling in exactly reverse priority', async () => {
    const page = racingPage({
      testid: { at: 200, lag: 40 },
      css: { at: 200, lag: 30 },
      role: { at: 200, lag: 20 },
      text: { at: 200, lag: 5 },
    });
    const r = await resolveTarget(
      page,
      { testid: 'save', css: '#save', role: 'button', text: 'Save' },
      { action: 'click', timeoutMs: 3_000 },
    );
    expect(r.resolved_via).toBe('testid');
  });

  it('the instrument discriminates: drop the testid layer and css really does win', async () => {
    // Without this, a test asserting "testid" could pass against an implementation
    // that always answers testid, which is not the property being claimed.
    const page = racingPage({ css: { at: 200, lag: 5 } });
    const r = await resolveTarget(page, { css: '#save' }, { action: 'click', timeoutMs: 3_000 });
    expect(r.resolved_via).toBe('css');
  });

  it('PINNED RESIDUAL: a higher-priority layer arriving STRICTLY LATER still loses', async () => {
    // Deliberate, not an oversight. Preferring testid here would mean waiting the
    // whole budget on every self-heal to find out whether it ever shows up — the
    // n × timeout trade F071.4 already refused. Layers describe one element, so
    // arriving at different times means they matched different elements, which is
    // the caller's spec to fix.
    const page = racingPage({ testid: { at: 900, lag: 5 }, css: { at: 200, lag: 5 } });
    const r = await resolveTarget(page, { testid: 'save', css: '#save' }, { action: 'click', timeoutMs: 3_000 });
    expect(r.resolved_via).toBe('css');
  });

  it('pass 1 is untouched: an already-present element still answers by priority', async () => {
    const page = racingPage({ testid: { at: 0, lag: 5 }, css: { at: 0, lag: 5 } });
    const r = await resolveTarget(page, { testid: 'save', css: '#save' }, { action: 'click', timeoutMs: 3_000 });
    expect(r.resolved_via).toBe('testid');
  });

  it('the correction waits for NOTHING — it is a snapshot, and the clock says so', async () => {
    // The whole budget is 3000ms and the element lands at 200ms. If the priority
    // correction were a second race, this would run to the budget.
    const page = racingPage({ testid: { at: 200, lag: 30 }, css: { at: 200, lag: 5 } });
    const t = Date.now();
    const r = await resolveTarget(page, { testid: 'save', css: '#save' }, { action: 'click', timeoutMs: 3_000 });
    const took = Date.now() - t;
    expect(r.resolved_via).toBe('testid');
    expect(took).toBeLessThan(600);
    // And the budget handed to the verb is what is LEFT, not the original.
    expect(r.remaining_ms).toBeLessThan(3_000);
    expect(r.remaining_ms).toBeGreaterThan(0);
  });
});

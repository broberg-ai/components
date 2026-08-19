// F071.4 AC#11 + AC#13 — the resolve criterion is chosen ONCE PER VERB, and both
// passes use the same one.
//
// `visible` for every targetable verb EXCEPT `upload`, which uses `attached`.
// setInputFiles deliberately does not require visibility, and a `display:none`
// file input is the standard pattern behind every styled upload control — a
// blanket `visible` would break uploads fleet-wide, silently, everywhere at once.
//
// WHY `visible` IS SAFE FOR THE OTHERS BY CONSTRUCTION, NOT BY CORPUS — and this
// argument is written here rather than only in the README so a later reader
// cannot weaken it by "simplifying" the criterion:
//
//   click · fill · type · press · select    require Playwright ACTIONABILITY,
//                                           which includes visibility.
//   expectVisible · expectEditable ·        each call waitFor({state:'visible'})
//   screenshot · waitFor · expectText       immediately after resolving.
//
// So a resolve that admitted hidden elements could never produce a PASSING step
// for those verbs — only a worse message ("matched, then invisible" instead of
// "not matched"). A corpus argument would only cover the flows that have been
// run; this one covers the ones that have not.
//
// The table is driven from the verb list, so a twelfth targetable verb that
// needs `attached` cannot be added without this test having an opinion about it.
import { describe, it, expect } from 'vitest';
import { resolveTarget } from '../src/flow.js';
import type { Page } from 'playwright';

/** One element, ATTACHED but never visible. `at` is when it attaches. */
function hiddenElementPage(at: number) {
  const t0 = Date.now();
  const leaf = () => {
    const present = () => Date.now() - t0 >= at;
    return {
      isVisible: async () => false,
      count: async () => (present() ? 1 : 0),
      async waitFor(o?: { state?: string; timeout?: number }) {
        const wantVisible = (o?.state ?? 'visible') === 'visible';
        const deadline = Date.now() + (o?.timeout ?? 30_000);
        for (;;) {
          if (present() && !wantVisible) return;
          if (Date.now() >= deadline) throw new Error(`Timeout ${o?.timeout}ms exceeded`);
          await new Promise((r) => setTimeout(r, 5));
        }
      },
    };
  };
  const layer = () => ({ nth: () => leaf(), first: () => leaf(), count: leaf().count });
  return {
    locator: () => layer(),
    getByTestId: () => layer(),
    getByRole: () => layer(),
    getByLabel: () => layer(),
    getByPlaceholder: () => layer(),
    getByText: () => layer(),
  } as unknown as Page;
}

/** Every verb that resolves a target. `upload` is the only exemption. */
const TARGETABLE = [
  'click',
  'fill',
  'type',
  'press',
  'select',
  'waitFor',
  'expectText',
  'expectVisible',
  'expectEditable',
  'screenshot',
  'upload',
] as const;

const resolvesHidden = async (action: string, at: number) => {
  const page = hiddenElementPage(at);
  try {
    const r = await resolveTarget(page, { css: '#hidden' }, { action, timeoutMs: 300 });
    return r.resolved_via;
  } catch {
    return null;
  }
};

describe('F071.4 — the criterion is per verb', () => {
  it('PASS 1: upload resolves a hidden file input, every other verb refuses it', async () => {
    const verdicts = await Promise.all(TARGETABLE.map((a) => resolvesHidden(a, 0)));
    const table = Object.fromEntries(TARGETABLE.map((a, i) => [a, verdicts[i]]));
    expect(table.upload).toBe('css');
    for (const a of TARGETABLE) {
      if (a === 'upload') continue;
      expect(table[a], `${a} must NOT resolve a hidden element`).toBeNull();
    }
  });

  it('PASS 2: the SAME verdicts when the element arrives late — one criterion, both passes', async () => {
    // The defect this rules out is flakiness built INTO the fix: the same element
    // passing or failing depending on which pass happened to reach it. Element
    // attaches at t+80ms, after pass 1's snapshot and inside pass 2's race.
    const verdicts = await Promise.all(TARGETABLE.map((a) => resolvesHidden(a, 80)));
    const table = Object.fromEntries(TARGETABLE.map((a, i) => [a, verdicts[i]]));
    expect(table.upload).toBe('css');
    for (const a of TARGETABLE) {
      if (a === 'upload') continue;
      expect(table[a], `${a} must NOT resolve a hidden element in pass 2 either`).toBeNull();
    }
  });
});

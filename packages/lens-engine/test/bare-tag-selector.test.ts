// F071.2 — a bare tag name is read as a data-testid, matches nothing, and says
// nothing about why.
//
// Found by the corpus check F071.1's review demanded: cardmem ran every
// clickSelector/fillSelector argument the fleet has ever sent — 224 calls, 115
// unique selectors — through this package's OWN resolveSelector. 114 passed
// through unchanged. `body` did not:
//
//   "body" -> [data-testid="body"]     "main" -> [data-testid="main"]
//   "form" -> [data-testid="form"]     "h1"   -> [data-testid="h1"]
//
// A locator matching zero elements is not an error. It is just nothing, and the
// failure surfaces later wearing a different face ("Timeout 30000ms exceeded").
//
// THE HEURISTIC IS NOT THE BUG AND IS NOT CHANGED. `main` is as plausible a
// data-testid as it is a tag name, so no rule reads a bare string correctly every
// time; widening it trades one silent miss for another and breaks anyone whose
// testid IS an element name. What changes is the SILENCE — so these tests assert
// on the message text, never merely that something threw.
import { describe, it, expect } from 'vitest';
import { execStep, selectorMissHint } from '../src/flow.js';
import { resolveSelector, isBareTagName } from '../src/capture.js';
import type { FlowStep } from '../src/schema.js';
import type { Page } from 'playwright';

/** A Page whose locators match nothing unless listed in `present`, and whose
 *  click fails the way Playwright's does — a timeout that names the selector and
 *  explains nothing about how that selector was arrived at. */
function fakePage(present: string[] = []) {
  const locator = (sel: string) => {
    const self: Record<string, unknown> = {
      first: () => self,
      count: async () => (present.includes(sel) ? 1 : 0),
      click: async () => {
        throw new Error(`locator.click: Timeout 30000ms exceeded.\nwaiting for locator('${sel}')`);
      },
      fill: async () => {
        throw new Error(`locator.fill: Timeout 30000ms exceeded.\nwaiting for locator('${sel}')`);
      },
    };
    return self;
  };
  return { locator, screenshot: async () => Buffer.alloc(0) } as unknown as Page;
}

const clickStep = (target: string): FlowStep => ({ action: 'click', target }) as FlowStep;

async function failureOf(step: FlowStep, present: string[] = []): Promise<string> {
  try {
    await execStep(fakePage(present), step, 'https://example.test', 30_000);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('expected the step to fail');
}

describe('F071.2 — the bare-tag class, not just the one reported string', () => {
  // The card reported `body`. A fix for `body` alone would leave the other five
  // producing the identical silence, which is how a class of defect survives the
  // story that closed it.
  const TAGS = ['body', 'main', 'form', 'h1', 'section', 'table'];

  it.each(TAGS)('a click on "%s" that matches nothing explains which reading was taken', async (tag) => {
    const msg = await failureOf(clickStep(tag));
    expect(msg).toContain(`"${tag}"`);
    expect(msg).toContain(`[data-testid="${tag}"]`);
    expect(msg).toContain('HTML element name');
    expect(msg).toContain(`{ css: "${tag}" }`);
  });

  it('names both readings — the one taken, the one available', async () => {
    const msg = await failureOf(clickStep('body'));
    // The original string, the selector actually used, and the explicit
    // alternative. Assert the CONTENT, not that it threw: "it threw" was already
    // true on 0.7.0, and told nobody anything.
    expect(msg).toContain('read as a data-testid VALUE');
    expect(msg).toContain('resolved to [data-testid="body"]');
    expect(msg).toContain('{ css: "body" }');
    // And the original Playwright failure survives — the hint adds, never replaces.
    expect(msg).toContain('Timeout 30000ms exceeded');
  });

  it('fires on fill too, not only click — the rewrite is in the resolver, not the verb', async () => {
    const step = { action: 'fill', target: 'form', value: 'x' } as FlowStep;
    expect(await failureOf(step)).toContain('HTML element name');
  });
});

describe('F071.2 — the negative controls', () => {
  // A hint that fires on every failed lookup is noise, and noise is not read.
  it('a genuine testid miss gets NO tag-name hint', async () => {
    const msg = await failureOf(clickStep('save-button'));
    expect(msg).toContain('Timeout 30000ms exceeded');
    expect(msg).not.toContain('HTML element name');
    expect(msg).not.toContain('{ css:');
  });

  it('a CSS selector that misses gets no hint — nothing was reinterpreted', async () => {
    for (const sel of ['#save', '.btn', 'button.primary', '[data-role="save"]']) {
      const msg = await failureOf(clickStep(sel));
      expect(msg).not.toContain('HTML element name');
    }
  });

  it('a tag-named testid that EXISTS and fails for another reason gets no hint', async () => {
    // The element is there; the click failed because it was covered/disabled.
    // Attaching "did you mean the element?" here would send the reader hunting
    // for a selector bug that does not exist.
    const msg = await failureOf(clickStep('main'), ['[data-testid="main"]']);
    expect(msg).toContain('Timeout 30000ms exceeded');
    expect(msg).not.toContain('HTML element name');
  });

  it('a LocateSpec target is never hinted — it stated its reading explicitly', async () => {
    const step = { action: 'click', target: { css: 'body' } } as unknown as FlowStep;
    let msg = '';
    try {
      await execStep(fakePage(), step, 'https://example.test', 30_000);
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    expect(msg).not.toContain('HTML element name');
  });
});

describe('F071.2 — the heuristic is UNCHANGED (this must not become a breaking change)', () => {
  // Anyone whose data-testid happens to be a tag name keeps working. The list of
  // element names EXPLAINS a miss; it never DECIDES a resolution.
  it.each([
    ['#save', '#save'],
    ['.btn', '.btn'],
    ['[data-testid="x"]', '[data-testid="x"]'],
    ['button.primary', 'button.primary'],
    ['div > span', 'div > span'],
    ['text=Log ind', 'text=Log ind'],
    [':nth-match(.dp-trigger, 2)', ':nth-match(.dp-trigger, 2)'],
    ['save-button', '[data-testid="save-button"]'],
    ['bodymap_root', '[data-testid="bodymap_root"]'],
    ['body', '[data-testid="body"]'],
    ['main', '[data-testid="main"]'],
  ])('resolveSelector(%j) === %j', (input, expected) => {
    expect(resolveSelector(input)).toBe(expected);
  });

  it('isBareTagName recognises elements without claiming non-elements', () => {
    for (const t of ['body', 'MAIN', ' form ', 'h1', 'table', 'section', 'dialog', 'search']) {
      expect(isBareTagName(t)).toBe(true);
    }
    for (const t of ['save-button', 'bodymap_root', 'login', 'submit-btn', 'card', 'modal']) {
      expect(isBareTagName(t)).toBe(false);
    }
  });

  it('selectorMissHint stays silent for anything it was not asked to explain', () => {
    expect(selectorMissHint('#save')).toBeNull();
    expect(selectorMissHint('.btn')).toBeNull();
    expect(selectorMissHint('save-button')).toBeNull();
    expect(selectorMissHint('body')).not.toBeNull();
  });
});

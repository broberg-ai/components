// @broberg/lens-engine — offline unit smoke. No real Chromium, no network. Tests
// the pure bits: Zod body parsing, storageState shaping, the self-healing locator
// priority, the selector/viewport resolvers, and the vision ships-dark gate.
//
// The app-side surfaces (R2 keying, MCP tool defs, the Bearer auth guard) are NOT
// in the engine and are tested by the consumer (lens-cloud), not here.

import { describe, test, expect } from 'vitest';
import {
  captureBodySchema,
  flowBodySchema,
  locateSpecSchema,
  mintAuthSchema,
  storageStateSchema,
  targetSchema,
  uploadFileSchema,
} from '../src/schema';
import { resolveSelector, resolveViewport } from '../src/capture';
import { plannedLayers, leadingNavigation, resolveTarget } from '../src/flow';
import { visionEnabled } from '../src/vision';

describe('captureBodySchema', () => {
  test('accepts a minimal viewport capture', () => {
    const r = captureBodySchema.safeParse({ url: 'https://autodoc.fly.dev' });
    expect(r.success).toBe(true);
  });

  test('accepts element mode with a selector + device + waitFor', () => {
    const r = captureBodySchema.safeParse({
      url: 'https://autodoc.fly.dev/board',
      mode: 'element',
      selector: 'board-root',
      device: 'iphone-14',
      waitFor: 500,
    });
    expect(r.success).toBe(true);
  });

  test('rejects a non-URL', () => {
    expect(captureBodySchema.safeParse({ url: 'not-a-url' }).success).toBe(false);
  });

  test('rejects an unknown mode', () => {
    expect(captureBodySchema.safeParse({ url: 'https://x.dev', mode: 'nope' }).success).toBe(false);
  });

  test('accepts a string (selector) waitFor', () => {
    const r = captureBodySchema.safeParse({ url: 'https://x.dev', waitFor: '#ready' });
    expect(r.success).toBe(true);
  });

  test('accepts a storageState object (auth-agnostic — no mint auth in the engine body)', () => {
    const r = captureBodySchema.safeParse({
      url: 'https://autodoc.fly.dev/board',
      storageState: { cookies: [{ name: 's', value: 'x.y', domain: '.autodoc.fly.dev', path: '/' }] },
    });
    expect(r.success).toBe(true);
  });
});

describe('mintAuthSchema (optional consumer helper input)', () => {
  test('requires the mintEndpoint literal + a URL', () => {
    expect(mintAuthSchema.safeParse({ adapter: 'x', url: 'https://a.dev' }).success).toBe(false);
    expect(mintAuthSchema.safeParse({ adapter: 'mintEndpoint', url: 'nope' }).success).toBe(false);
  });

  test('allows optional body + headers', () => {
    const r = mintAuthSchema.safeParse({
      adapter: 'mintEndpoint',
      url: 'https://a.dev/mint',
      secret: 's',
      body: { mode: 'write', writes: true },
      headers: { 'x-flow': 'signup' },
    });
    expect(r.success).toBe(true);
  });
});

describe('storageStateSchema', () => {
  test('parses a Playwright storageState', () => {
    const r = storageStateSchema.safeParse({
      cookies: [{ name: 'projects.session_token', value: 'x.y', domain: '.cardmem.com', path: '/' }],
      origins: [{ origin: 'https://cardmem.com', localStorage: [{ name: 'k', value: 'v' }] }],
    });
    expect(r.success).toBe(true);
  });

  test('an empty object is structurally valid (emptiness enforced at apply-time)', () => {
    expect(storageStateSchema.safeParse({}).success).toBe(true);
  });
});

describe('flowBodySchema', () => {
  test('accepts a full storeform-style manuscript', () => {
    const r = flowBodySchema.safeParse({
      name: 'play-console-upload',
      base_url: 'https://play.google.com',
      mutates: true,
      steps: [
        { action: 'goto', url: '/console', waitFor: '#app' },
        { action: 'click', target: 'create-release' },
        { action: 'fill', target: 'release-notes', value: 'v1.2.0' },
        { action: 'type', target: 'search', text: 'my app' },
        { action: 'press', key: 'Enter' },
        { action: 'select', target: 'track', value: 'production' },
        { action: 'upload', target: 'aab-input', files: [{ name: 'app.aab', url: 'https://r2.example/app.aab' }] },
        { action: 'waitFor', target: 'upload-done' },
        { action: 'expectVisible', target: 'submit-btn' },
        { action: 'expectText', target: 'status', text: 'Ready' },
        { action: 'assert', js: 'document.querySelectorAll(".error").length === 0' },
        { action: 'screenshot', name: 'final', mode: 'fullPage' },
      ],
    });
    expect(r.success).toBe(true);
  });

  test('accepts a storageState object (auth-agnostic engine body)', () => {
    const r = flowBodySchema.safeParse({
      base_url: 'https://a.dev',
      storageState: { cookies: [{ name: 's', value: 'x', domain: '.a.dev', path: '/' }] },
      steps: [{ action: 'goto', url: '/' }],
    });
    expect(r.success).toBe(true);
  });

  test('requires an absolute base_url + at least one step', () => {
    expect(flowBodySchema.safeParse({ base_url: 'nope', steps: [{ action: 'goto', url: '/' }] }).success).toBe(false);
    expect(flowBodySchema.safeParse({ base_url: 'https://a.dev', steps: [] }).success).toBe(false);
  });

  test('rejects an unknown step action', () => {
    const r = flowBodySchema.safeParse({ base_url: 'https://a.dev', steps: [{ action: 'teleport', target: 'x' }] });
    expect(r.success).toBe(false);
  });

  test('a fill step needs value; a click step needs target', () => {
    expect(flowBodySchema.safeParse({ base_url: 'https://a.dev', steps: [{ action: 'fill', target: 'x' }] }).success).toBe(false);
    expect(flowBodySchema.safeParse({ base_url: 'https://a.dev', steps: [{ action: 'click' }] }).success).toBe(false);
  });
});

describe('self-healing locators', () => {
  test('targetSchema accepts a plain string (back-compat)', () => {
    expect(targetSchema.safeParse('submit-btn').success).toBe(true);
    expect(targetSchema.safeParse('.card > button').success).toBe(true);
  });

  test('targetSchema accepts a LocateSpec with ≥1 hint', () => {
    expect(targetSchema.safeParse({ role: 'button', name: 'Save' }).success).toBe(true);
    expect(targetSchema.safeParse({ text: 'More information' }).success).toBe(true);
    expect(targetSchema.safeParse({ label: 'Email', exact: true }).success).toBe(true);
  });

  test('an empty LocateSpec is rejected (needs ≥1 hint)', () => {
    expect(locateSpecSchema.safeParse({}).success).toBe(false);
    expect(locateSpecSchema.safeParse({ exact: true, nth: 0 }).success).toBe(false);
  });

  test('a /flow step can target a LocateSpec', () => {
    const r = flowBodySchema.safeParse({
      base_url: 'https://appstoreconnect.apple.com',
      steps: [
        { action: 'click', target: { role: 'button', name: 'New Version' } },
        { action: 'fill', target: { label: 'Version Number' }, value: '1.2.0' },
        { action: 'upload', target: { text: 'Choose File' }, files: [{ name: 'a.png', content_base64: 'iVBOR=' }] },
      ],
    });
    expect(r.success).toBe(true);
  });

  test('plannedLayers returns the supplied layers in fixed priority order', () => {
    expect(
      plannedLayers({ text: 'x', role: 'button', testid: 't', css: '.c', label: 'l', placeholder: 'p', vision: 'v' }),
    ).toEqual(['testid', 'css', 'role', 'label', 'placeholder', 'text', 'vision']);
  });

  test('plannedLayers includes only the hints that are present', () => {
    expect(plannedLayers({ role: 'heading', name: 'Example Domain' })).toEqual(['role']);
    expect(plannedLayers({ text: 'Submit' })).toEqual(['text']);
    expect(plannedLayers({ testid: 't', vision: 'the blue button' })).toEqual(['testid', 'vision']);
  });
});

describe('leadingNavigation — base_url auto-nav parity (F049)', () => {
  test('a flow that does NOT open with a goto pre-navigates to base_url', () => {
    expect(leadingNavigation({ base_url: 'https://a.dev', steps: [{ action: 'click', target: 'x' }] })).toBe(
      'https://a.dev',
    );
    expect(
      leadingNavigation({ base_url: 'https://a.dev', steps: [{ action: 'fill', target: 'x', value: 'v' }] }),
    ).toBe('https://a.dev');
  });

  test('a leading goto is a no-op (idempotent — the goto already navigates)', () => {
    expect(leadingNavigation({ base_url: 'https://a.dev', steps: [{ action: 'goto', url: '/' }] })).toBeNull();
  });

  test('no base_url → no implicit navigation', () => {
    expect(leadingNavigation({ base_url: '', steps: [{ action: 'click', target: 'x' }] })).toBeNull();
  });
});

describe('resolveTarget — exported self-heal resolver (F050)', () => {
  // Duck-typed fake page: just enough Locator-factory surface to drive the resolver
  // OFFLINE (no real Chromium — same strategy as the rest of this file; the live
  // DOM resolution against a real page is proven by the consumer/daemon).
  const fakePage = {
    locator: (sel: string) => ({ first: () => `SEL:${sel}`, count: async () => 0, nth: (n: number) => `CSS:${sel}#${n}` }),
    getByTestId: (id: string) => ({ count: async () => 1, nth: (n: number) => `TESTID:${id}#${n}` }),
    getByRole: () => ({ count: async () => 0, nth: (n: number) => `ROLE#${n}` }),
    getByLabel: () => ({ count: async () => 0, nth: (n: number) => `LABEL#${n}` }),
    getByPlaceholder: () => ({ count: async () => 0, nth: (n: number) => `PH#${n}` }),
    getByText: () => ({ count: async () => 0, nth: (n: number) => `TEXT#${n}` }),
  } as unknown as Parameters<typeof resolveTarget>[0];

  test('a string target resolves via the selector layer (bare testid wrapped)', async () => {
    const r = await resolveTarget(fakePage, 'save-btn');
    expect(r.resolved_via).toBe('selector');
    expect(r.locator).toBe('SEL:[data-testid="save-btn"]');
  });

  test('a LocateSpec resolves via its first matching DOM layer, surfacing resolved_via', async () => {
    const r = await resolveTarget(fakePage, { testid: 'version' });
    expect(r.resolved_via).toBe('testid');
    expect(r.locator).toBe('TESTID:version#0');
  });

  test('a LocateSpec whose DOM layers all miss (no vision) throws — never guesses', async () => {
    await expect(resolveTarget(fakePage, { role: 'button', name: 'Nope' })).rejects.toThrow(/no layer matched/);
  });

  test('a nullish target throws with the opts.action label', async () => {
    await expect(resolveTarget(fakePage, null as unknown as string, { action: 'fill' })).rejects.toThrow(
      /fill step requires a target/,
    );
    await expect(resolveTarget(fakePage, undefined as unknown as string)).rejects.toThrow(
      /locate step requires a target/,
    );
  });
});

describe('vision fallback ships dark', () => {
  test('visionEnabled requires BOTH the flag AND a provider key', () => {
    const flag = process.env.LENS_VISION_ENABLED;
    const mistral = process.env.MISTRAL_API_KEY;
    const openrouter = process.env.OPENROUTER_API_KEY;
    const restore = () => {
      flag === undefined ? delete process.env.LENS_VISION_ENABLED : (process.env.LENS_VISION_ENABLED = flag);
      mistral === undefined ? delete process.env.MISTRAL_API_KEY : (process.env.MISTRAL_API_KEY = mistral);
      openrouter === undefined ? delete process.env.OPENROUTER_API_KEY : (process.env.OPENROUTER_API_KEY = openrouter);
    };
    try {
      process.env.LENS_VISION_ENABLED = '1';
      delete process.env.MISTRAL_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      expect(visionEnabled()).toBe(false); // no provider key → dark
      process.env.MISTRAL_API_KEY = 'x';
      delete process.env.LENS_VISION_ENABLED;
      expect(visionEnabled()).toBe(false); // flag missing → dark
      process.env.LENS_VISION_ENABLED = '1';
      expect(visionEnabled()).toBe(true); // flag + a key → live (Mistral key)
      delete process.env.MISTRAL_API_KEY;
      process.env.OPENROUTER_API_KEY = 'y';
      expect(visionEnabled()).toBe(true); // OpenRouter key alone also enables
    } finally {
      restore();
    }
  });
});

describe('uploadFileSchema (exactly-one-of url | content_base64)', () => {
  test('accepts a url-sourced file', () => {
    expect(uploadFileSchema.safeParse({ name: 'a.png', url: 'https://r2.example/a.png' }).success).toBe(true);
  });
  test('accepts an inline base64 file', () => {
    expect(uploadFileSchema.safeParse({ name: 'a.png', content_base64: 'iVBORw0KGgo=' }).success).toBe(true);
  });
  test('rejects BOTH sources', () => {
    expect(
      uploadFileSchema.safeParse({ name: 'a', url: 'https://r2.example/a', content_base64: 'x' }).success,
    ).toBe(false);
  });
  test('rejects NEITHER source', () => {
    expect(uploadFileSchema.safeParse({ name: 'a' }).success).toBe(false);
  });
});

describe('resolveSelector', () => {
  test('wraps a bare token as a data-testid', () => {
    expect(resolveSelector('board-root')).toBe('[data-testid="board-root"]');
  });
  test('passes a CSS selector through unchanged', () => {
    expect(resolveSelector('.card > .title')).toBe('.card > .title');
    expect(resolveSelector('[data-testid="x"]')).toBe('[data-testid="x"]');
    expect(resolveSelector('#main')).toBe('#main');
  });
});

describe('resolveViewport', () => {
  test('explicit viewport wins', () => {
    expect(resolveViewport({ viewport: { width: 500, height: 400 } })).toEqual({ width: 500, height: 400 });
  });
  test('device preset resolves', () => {
    expect(resolveViewport({ device: 'iphone-14' })).toEqual({ width: 390, height: 844 });
  });
  test('falls back to the default', () => {
    expect(resolveViewport({})).toEqual({ width: 1280, height: 800 });
  });
  test('an unknown device falls back to the default', () => {
    expect(resolveViewport({ device: 'nokia-3310' })).toEqual({ width: 1280, height: 800 });
  });
});
